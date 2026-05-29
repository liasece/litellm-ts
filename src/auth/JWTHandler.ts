/**
 * JWTHandler — JWT 令牌处理
 *
 * 完整的 JWT 验证实现，使用 Node.js 原生 crypto 模块。
 * JWKS 公钥缓存（TTL 10min），支持 RS256/384/512, PS256/384/512,
 * ES256/384/512, EdDSA 签名算法。
 * 支持 OIDC discovery 自动解析 JWKS URL 和 OIDC UserInfo 端点。
 *
 * JWT-001: 显式支持 HS256/HS384/HS512（HMAC 对称密钥）— 通过 constructor `hmacSecret` 显式 gating；
 *          未配置 `hmacSecret` 时拒绝所有 HS* token。HS* 不在 Python litellm 默认算法白名单，
 *          TS 保留以支持内部共享密钥场景。
 * JWT-002: 支持 `audience` 和 `issuer` 校验（PY litellm.proxy.auth.handle_jwt.py:720-727）
 *          + `leeway` 时钟漂移容忍。
 *
 * DIFF-JWT-CLAIMS-02: JWTHandler 继承 JWTClaimsExtractor，所有 get*Id / get*Role / get*Email
 * 等 claim 提取方法直接来自父类，**保持 handler.getTeamId(...) API 不破坏**。
 * DIFF-JWT-VERIFY-01: 三段验签（HMAC/x5c/JWK）共享 `_runVerify(publicKey, signedData, signature, alg)`
 * helper，消除 createVerify 分支重复。
 */

import * as crypto from "node:crypto";
import { createModuleLogger } from "../core/utils/logger";
import { JWTClaimsExtractor } from "./JWTClaimsExtractor";

const logger = createModuleLogger("JWTHandler");

/**
 * 算法 → Node.js hash name 映射
 * GAP: 新增 HS256/HS384/HS512（对称密钥 HMAC）；显式禁止 alg=none（JWT 安全准则）
 */
const ALG_TO_HASH: Record<string, string | null> = {
	RS256: "RSA-SHA256",
	RS384: "RSA-SHA384",
	RS512: "RSA-SHA512",
	PS256: "RSA-SHA256",
	PS384: "RSA-SHA384",
	PS512: "RSA-SHA512",
	ES256: "sha256",
	ES384: "sha384",
	ES512: "sha512",
	HS256: "sha256",
	HS384: "sha384",
	HS512: "sha512",
	EdDSA: null, // no hash needed
};

/**
 * HMAC 对称密钥算法集合 — 需要 shared secret 验签
 */
const HMAC_ALGORITHMS = new Set(["HS256", "HS384", "HS512"]);

/**
 * 显式拒绝列表（JWT alg=none 安全漏洞 — CVE-2015-9235 等）
 */
const REJECTED_ALGORITHMS = new Set(["none", "None", "NONE", ""]);

/**
 * PS (RSASSA-PSS) 算法集合——需要 PSS padding
 */
const PSS_ALGORITHMS = new Set(["PS256", "PS384", "PS512"]);

/**
 * EC 算法集合
 */
const EC_ALGORITHMS = new Set(["ES256", "ES384", "ES512"]);

/**
 * JWT 处理器
 *
 * DIFF-JWT-CLAIMS-02: 继承 JWTClaimsExtractor 复用 get*Id / get*Role / get*Email 等
 * claim 提取方法，删除原本 13 个一行委托方法。
 */
export class JWTHandler extends JWTClaimsExtractor {
	private _jwksUrl?: string;
	private _jwksCache: { keys: Record<string, crypto.JsonWebKey>; expiresAt: number } | null = null;
	/** DIFF-AUTH-01: 原始 JWKS 列表缓存（含 x5c），用于 kid 命中失败时回退 */
	private _jwksRawCache: { keys: Array<{ kid?: string; x5c?: string[] } & crypto.JsonWebKey>; expiresAt: number } | null = null;
	private _oidcUserinfoEndpoint?: string;
	private _oidcUserinfoCacheTtlMs: number;
	/** GAP: HS256/HS384/HS512 验签所需的 shared secret（对称密钥） */
	private _hmacSecret?: string;
	/** JWT-002: audience claim 校验（PY: jwt.decode(audience=...)） */
	private _audience?: string | string[];
	/** JWT-002: issuer claim 校验（PY: litellm_jwtauth.iss_jwt_field） */
	private _issuer?: string;
	/** JWT-002: 时钟漂移容忍（秒），PY 默认 0 */
	private _leeway: number;
	private static readonly _cacheTtlMs = 10 * 60 * 1000;

	/**
	 * @param jwksUrl - JWKS 端点 URL（可选）
	 * @param oidcUserinfoEndpoint - OIDC UserInfo 端点 URL（可选）
	 * @param oidcUserinfoCacheTtlMs - OIDC UserInfo 缓存 TTL（毫秒，默认 5 分钟）
	 * @param hmacSecret - HS256/HS384/HS512 对称密钥（可选；用于支持 HMAC 签名 JWT）
	 * @param audience - JWT-002: 期望的 audience 声明（字符串或字符串数组）
	 * @param issuer - JWT-002: 期望的 issuer 声明
	 * @param leeway - JWT-002: 时钟漂移容忍（秒），默认 0
	 */
	// eslint-disable-next-line max-params
	constructor(
		jwksUrl?: string,
		oidcUserinfoEndpoint?: string,
		oidcUserinfoCacheTtlMs = 5 * 60 * 1000,
		hmacSecret?: string,
		audience?: string | string[],
		issuer?: string,
		leeway = 0,
	) {
		super();
		this._jwksUrl = jwksUrl;
		this._oidcUserinfoEndpoint = oidcUserinfoEndpoint;
		this._oidcUserinfoCacheTtlMs = oidcUserinfoCacheTtlMs;
		this._hmacSecret = hmacSecret;
		this._audience = audience;
		this._issuer = issuer;
		this._leeway = leeway;
	}

	/**
	 * DIFF-JWT-CLAIMS-01: claims 校验 helper
	 * 集中 exp / nbf / iss / aud 校验逻辑，消除 HMAC / x5c / JWK 三处验签后重复代码。
	 * @param claims - 解码后的 claims
	 * @param options - 可选 leewayMs 覆盖（默认用实例 _leeway）
	 * @returns true 若通过全部校验，false 若任一校验失败
	 */
	private _validateClaims(claims: Record<string, unknown>, options?: { leewayMs?: number }): boolean {
		const leewayMs = options?.leewayMs ?? this._leeway * 1000;
		// 检查 exp（过期时间）
		if (typeof claims.exp === "number" && claims.exp * 1000 + leewayMs < Date.now()) {
			return false;
		}
		// 检查 nbf（生效时间）
		if (typeof claims.nbf === "number" && claims.nbf * 1000 - leewayMs > Date.now()) {
			return false;
		}
		// 校验 iss
		if (this._issuer !== undefined && claims.iss !== this._issuer) {
			return false;
		}
		// 校验 aud
		if (this._audience !== undefined) {
			const audiences = Array.isArray(this._audience) ? this._audience : [this._audience];
			const claimAud = claims.aud;
			const audList = Array.isArray(claimAud) ? claimAud : claimAud !== undefined ? [claimAud] : [];
			const matched = audList.some((a) => audiences.includes(a as string));
			if (!matched) {
				return false;
			}
		}
		return true;
	}

	/**
	 * DIFF-JWT-VERIFY-01: 共享的 verify helper，把 HMAC / x5c / JWK 三段验签的
	 * `createVerify + update + verify` 重复代码抽到此处。
	 * @param publicKey - 已导入的公钥（KeyObject）
	 * @param signedData - 待验签的字符串
	 * @param signature - 签名 buffer
	 * @param alg - JWT alg 字符串
	 * @returns true 若验签通过
	 */
	private _runVerify(publicKey: crypto.KeyObject, signedData: string, signature: Buffer, alg: string): boolean {
		const hashName = JWTHandler.mapAlgorithm(alg);
		const isPss = JWTHandler.isPssAlgorithm(alg);
		if (hashName === null) {
			// EdDSA: use key type to determine algorithm
			const keyType = publicKey.asymmetricKeyType;
			if (keyType !== "ed25519" && keyType !== "ed448") {
				return false;
			}
			const verify = crypto.createVerify(null as unknown as string);
			verify.update(signedData);
			return verify.verify(publicKey, signature);
		}
		const verify = crypto.createVerify(hashName);
		verify.update(signedData);
		if (isPss) {
			return verify.verify(
				{
					key: publicKey,
					padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
					saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
				},
				signature,
			);
		}
		return verify.verify(publicKey, signature);
	}

	/**
	 * 检查字符串是否为 JWT 格式
	 * @param token - 待检查的令牌字符串
	 * @returns true 若为三段式 JWT
	 */
	static isJwt(token: string): boolean {
		return token.split(".").length === 3;
	}

	/**
	 * 解析 JWT 算法名称为 Node.js crypto 可接受的 hash 名称。
	 * GAP: 返回 null 表示 EdDSA；未知或被拒绝的 alg 也返回 null（不再 fallback 到 RSA-SHA256）。
	 * @param alg - JWT alg 头
	 */
	static mapAlgorithm(alg: string): string | null {
		if (REJECTED_ALGORITHMS.has(alg)) {
			return null;
		}
		if (Object.prototype.hasOwnProperty.call(ALG_TO_HASH, alg)) {
			return ALG_TO_HASH[alg] as string | null;
		}
		// 未知 alg 不再 fallback 到 RSA-SHA256，返回 null（verifyJwt 应据此拒绝 token）
		return null;
	}

	/**
	 * 检查算法是否是 HMAC 对称算法（HS256/HS384/HS512）
	 * @param alg - JWT alg 头
	 */
	static isHmacAlgorithm(alg: string): boolean {
		return HMAC_ALGORITHMS.has(alg);
	}

	/**
	 * 检查算法是否使用 RSASSA-PSS padding
	 * @param alg - JWT alg 头
	 */
	static isPssAlgorithm(alg: string): boolean {
		return PSS_ALGORITHMS.has(alg);
	}

	/**
	 * 检查算法是否是 EC
	 * @param alg - JWT alg 头
	 */
	static isEcAlgorithm(alg: string): boolean {
		return EC_ALGORITHMS.has(alg);
	}

	/**
	 * 解析 OIDC discovery URL，若 URL 指向 well-known/openid-configuration，
	 * 则自动获取并缓存 JWKS URI。
	 * PY ref: handle_jwt.py:468-512
	 * @param url - JWKS URL 或 OIDC discovery URL
	 */
	async _resolveJwksUrl(url: string): Promise<string> {
		if (!url.includes(".well-known/openid-configuration")) {
			return url;
		}
		if (this._jwksCache && this._jwksCache.expiresAt > Date.now()) {
			// We don't cache the discovery separately — just fetch
		}
		logger.debug(`Resolving OIDC discovery URL: ${url}`);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`OIDC discovery endpoint ${url} returned status ${response.status}`);
		}
		const discovery = (await response.json()) as Record<string, unknown>;
		const jwksUri = discovery.jwks_uri as string | undefined;
		if (!jwksUri) {
			throw new Error(`OIDC discovery document at ${url} does not contain a 'jwks_uri' field`);
		}
		logger.debug(`Resolved OIDC discovery ${url} -> jwks_uri=${jwksUri}`);
		return jwksUri;
	}

	/**
	 * 获取 JWKS 公钥集合（带缓存，支持 OIDC discovery）
	 *
	 * DIFF-AUTH-01: 同步缓存原始 JWKS 列表（含 x5c），以支持 kid 命中失败时回退到 x5c
	 * 兜底（PY handle_jwt.py:355-401 在 kid 找不到时尝试 x5c 第一个 key）。
	 * @returns JWK 键值对（kid → JWK）
	 */
	async _fetchJwks(): Promise<Record<string, crypto.JsonWebKey>> {
		if (this._jwksCache && Date.now() < this._jwksCache.expiresAt) {
			return this._jwksCache.keys;
		}

		if (!this._jwksUrl) {
			throw new Error("JWKS URL not configured");
		}

		// PY: Resolve OIDC discovery URL if applicable
		const resolvedUrl = await this._resolveJwksUrl(this._jwksUrl);

		const response = await fetch(resolvedUrl);
		if (!response.ok) {
			throw new Error(`JWKS fetch failed: ${response.status}`);
		}

		const jwks = (await response.json()) as { keys: Array<{ kid: string; x5c?: string[] } & crypto.JsonWebKey> };
		const keys: Record<string, crypto.JsonWebKey> = {};
		for (const key of jwks.keys) {
			if (key.kid) {
				keys[key.kid] = key;
			}
		}

		// DIFF-AUTH-01: 同时缓存原始 JWKS 列表用于 x5c 兜底（PY: handle_jwt.py:355-401）。
		// 保留 x5c 字段以备后续 PEM base64 解码。
		this._jwksCache = { keys: keys, expiresAt: Date.now() + JWTHandler._cacheTtlMs };
		this._jwksRawCache = { keys: jwks.keys, expiresAt: this._jwksCache.expiresAt };
		return keys;
	}

	/**
	 * DIFF-AUTH-01: 获取 JWKS 中第一个含 x5c 字段的 key，并把它当作 x509 PEM 公钥返回。
	 * 对齐 PY handle_jwt.py:355-401 — kid 命中失败时回退到 x5c 第一个 key。
	 *
	 * 注：JWK 字段 `x5c` 是 base64 DER 证书链。取首项拼接 PEM header/footer 后可直接
	 * 用 `crypto.createPublicKey` 导入。
	 * @returns PEM 公钥字符串（无 x5c 时返回 null）
	 */
	async _getX5cFallbackKey(): Promise<string | null> {
		if (!this._jwksRawCache || Date.now() >= this._jwksRawCache.expiresAt) {
			await this._fetchJwks();
		}
		const raw = this._jwksRawCache?.keys ?? [];
		for (const key of raw) {
			if (Array.isArray(key.x5c) && key.x5c.length > 0) {
				const cert = key.x5c[0]!;
				return `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
			}
		}
		return null;
	}

	/**
	 * OIDC UserInfo 端点获取用户信息。
	 * PY ref: handle_jwt.py:597-662
	 * @param token - 访问令牌
	 * @returns 用户信息对象
	 */
	async getOidcUserinfo(token: string): Promise<Record<string, unknown>> {
		if (!this._oidcUserinfoEndpoint) {
			throw new Error("OIDC UserInfo endpoint not configured");
		}
		const response = await fetch(this._oidcUserinfoEndpoint, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/json",
			},
		});
		if (!response.ok) {
			throw new Error(`OIDC UserInfo endpoint returned status ${response.status}`);
		}
		const userinfo = (await response.json()) as Record<string, unknown>;
		return userinfo;
	}

	/**
	 * 验证 JWT 令牌
	 *
	 * 步骤：
	 * 1. base64url 解码 header → 获取 kid、alg
	 * 2. 查 JWKS 缓存 → 获取公钥
	 * 3. crypto.createVerify 验签（支持 RS256/384/512, PS256/384/512, ES256/384/512, EdDSA）
	 * 4. 检查 exp / nbf 声明
	 * @param token - JWT 令牌字符串
	 * @returns 解析后的 claims 对象，若验证失败返回 null
	 */
	async verifyJwt(token: string): Promise<{ claims: Record<string, unknown> } | null> {
		try {
			const parts = token.split(".");
			if (parts.length !== 3) {
				return null;
			}

			// 解码 header 获取 kid、alg
			const headerJson = Buffer.from(parts[0]!, "base64url").toString("utf8");
			const header = JSON.parse(headerJson) as { kid?: string; alg?: string };

			const alg = header.alg ?? "RS256";

			// GAP: 显式拒绝 alg=none / "" / 大小写变体（JWT 安全漏洞 CVE-2015-9235）
			if (REJECTED_ALGORITHMS.has(alg)) {
				return null;
			}

			// GAP: HS256/HS384/HS512 对称密钥（HMAC）验签路径
			if (HMAC_ALGORITHMS.has(alg)) {
				if (!this._hmacSecret) {
					// 未配置共享密钥时拒绝 HS 算法 token，避免 fallback 绕过
					return null;
				}
				const hashName = ALG_TO_HASH[alg] as string;
				const hmac = crypto.createHmac(hashName, this._hmacSecret);
				hmac.update(`${parts[0]}.${parts[1]}`);
				const expected = hmac.digest();
				const actual = Buffer.from(parts[2]!, "base64url");
				if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
					return null;
				}
				// HMAC 验签通过 → 解码 payload 后做 exp / nbf / iss / aud 检查
				const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
				const claims = JSON.parse(payloadJson) as Record<string, unknown>;
				// DIFF-JWT-CLAIMS-01: 委托给 _validateClaims 统一 exp/nbf/iss/aud 校验
				if (!this._validateClaims(claims)) {
					return null;
				}
				return { claims: claims };
			}

			// 非 HMAC 算法 — 走 JWKS 公钥路径，需要 kid
			if (!header.kid) {
				return null;
			}

			// 获取 JWKS 公钥
			const keys = await this._fetchJwks();
			const jwk = keys[header.kid];
			const signedData = `${parts[0]}.${parts[1]}`;
			const signature = Buffer.from(parts[2]!, "base64url");

			if (!jwk) {
				// DIFF-AUTH-01: kid 未命中时回退到 x5c 第一个 key（PY handle_jwt.py:355-401）
				const x5cPem = await this._getX5cFallbackKey();
				if (x5cPem) {
					const x5cPublicKey = crypto.createPublicKey(x5cPem);
					// DIFF-JWT-VERIFY-01: 委托给 _runVerify helper
					if (!this._runVerify(x5cPublicKey, signedData, signature, alg)) {
						return null;
					}
					const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
					const x5cClaims = JSON.parse(payloadJson) as Record<string, unknown>;
					if (!this._validateClaims(x5cClaims)) {
						return null;
					}
					return { claims: x5cClaims };
				}
				return null;
			}

			// 导入公钥
			const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
			// DIFF-JWT-VERIFY-01: 委托给 _runVerify helper
			if (!this._runVerify(publicKey, signedData, signature, alg)) {
				return null;
			}

			// 解码 payload
			const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
			const claims = JSON.parse(payloadJson) as Record<string, unknown>;

			// DIFF-JWT-CLAIMS-01: 委托给 _validateClaims 统一 exp/nbf/iss/aud 校验
			if (!this._validateClaims(claims)) {
				return null;
			}

			return { claims: claims };
		} catch {
			return null;
		}
	}

	/**
	 * 刷新 JWKS 公钥缓存
	 *
	 * 清除缓存并强制从配置的 JWKS 端点获取最新公钥集合。
	 */
	async refreshJwks(): Promise<void> {
		this._jwksCache = null;
		if (this._jwksUrl) {
			await this._fetchJwks();
		}
		logger.debug("JWKS 缓存已刷新");
	}
}
