/**
 * JWTHandler — JWT 令牌处理
 *
 * 完整的 JWT 验证实现，使用 Node.js 原生 crypto 模块。
 * JWKS 公钥缓存（TTL 10min），支持 RS256 签名验证。
 */

import * as crypto from "node:crypto";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("JWTHandler");

/**
 * JWT 处理器
 */
export class JWTHandler {
	private _jwksUrl?: string;
	private _jwksCache: { keys: Record<string, crypto.JsonWebKey>; expiresAt: number } | null = null;
	private static readonly _cacheTtlMs = 10 * 60 * 1000;

	/**
	 * @param jwksUrl - JWKS 端点 URL（可选）
	 */
	constructor(jwksUrl?: string) {
		this._jwksUrl = jwksUrl;
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
	 * 获取 JWKS 公钥集合（带缓存）
	 * @returns JWK 键值对（kid → JWK）
	 */
	async _fetchJwks(): Promise<Record<string, crypto.JsonWebKey>> {
		if (this._jwksCache && Date.now() < this._jwksCache.expiresAt) {
			return this._jwksCache.keys;
		}

		if (!this._jwksUrl) {
			throw new Error("JWKS URL not configured");
		}

		const response = await fetch(this._jwksUrl);
		if (!response.ok) {
			throw new Error(`JWKS fetch failed: ${response.status}`);
		}

		const jwks = (await response.json()) as { keys: Array<{ kid: string } & crypto.JsonWebKey> };
		const keys: Record<string, crypto.JsonWebKey> = {};
		for (const key of jwks.keys) {
			if (key.kid) {
				keys[key.kid] = key;
			}
		}

		this._jwksCache = { keys: keys, expiresAt: Date.now() + JWTHandler._cacheTtlMs };
		return keys;
	}

	/**
	 * 验证 JWT 令牌
	 *
	 * 步骤：
	 * 1. base64url 解码 header → 获取 kid
	 * 2. 查 JWKS 缓存 → 获取公钥
	 * 3. crypto.createVerify 验签
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

			// 解码 header 获取 kid
			const headerJson = Buffer.from(parts[0]!, "base64url").toString("utf8");
			const header = JSON.parse(headerJson) as { kid?: string; alg?: string };
			if (!header.kid) {
				return null;
			}

			// 获取 JWKS 公钥
			const keys = await this._fetchJwks();
			const jwk = keys[header.kid];
			if (!jwk) {
				return null;
			}

			// 导入公钥
			const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });

			// 验签
			const signedData = `${parts[0]}.${parts[1]}`;
			const signature = Buffer.from(parts[2]!, "base64url");
			const alg = header.alg ?? "RS256";
			const verify = crypto.createVerify(alg.startsWith("RS") ? "RSA-SHA256" : "sha256");
			verify.update(signedData);
			if (!verify.verify(publicKey, signature)) {
				return null;
			}

			// 解码 payload
			const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
			const claims = JSON.parse(payloadJson) as Record<string, unknown>;

			// 检查 exp（过期时间）
			if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
				return null;
			}

			// 检查 nbf（生效时间）
			if (typeof claims.nbf === "number" && claims.nbf * 1000 > Date.now()) {
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
