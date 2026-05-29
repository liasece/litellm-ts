/**
 * JWTHandler 测试
 *
 * 对齐 Python litellm/proxy/auth/handle_jwt.py + test_handle_jwt.py
 * 覆盖：
 *  - 显式拒绝 alg=none（JWT 安全准则 CVE-2015-9235）
 *  - HMAC（HS256/384/512）路径：未配置 hmacSecret 时拒绝；配置后接受
 *  - 非对称（RS256/PS256/ES256/EdDSA）通过 JWKS 验证
 *  - exp / nbf 校验
 *  - iss / aud 校验（JWT-002）
 *  - leeway 时钟漂移容忍（JWT-002）
 */
import * as crypto from "node:crypto";
import { JWTHandler } from "./JWTHandler";

/**
 * 工具：base64url 编码
 * @param input
 */
function b64url(input: Buffer | string): string {
	return Buffer.from(input).toString("base64url");
}

/**
 * 工具：构造一个 HS256 JWT
 * @param payload
 * @param secret
 */
function makeHS256(payload: Record<string, unknown>, secret: string): string {
	const header = { alg: "HS256", typ: "JWT" };
	const headerB64 = b64url(JSON.stringify(header));
	const payloadB64 = b64url(JSON.stringify(payload));
	const signingInput = `${headerB64}.${payloadB64}`;
	const sig = crypto.createHmac("sha256", secret).update(signingInput).digest();
	return `${signingInput}.${b64url(sig)}`;
}

/**
 * 工具：构造一个 RS256 JWT（用于非对称路径）
 * @param payload
 * @param privateKey
 * @param publicJwk
 */
function makeRS256(payload: Record<string, unknown>, privateKey: crypto.KeyObject, publicJwk: Record<string, unknown>): string {
	const header = { alg: "RS256", typ: "JWT", kid: "test-key" };
	const headerB64 = b64url(JSON.stringify(header));
	const payloadB64 = b64url(JSON.stringify(payload));
	const signingInput = `${headerB64}.${payloadB64}`;
	const sign = crypto.createSign("RSA-SHA256");
	sign.update(signingInput);
	sign.end();
	const sig = sign.sign(privateKey);
	return `${signingInput}.${b64url(sig)}`;
}

describe("JWTHandler", () => {
	describe("alg=none 显式拒绝（CVE-2015-9235）", () => {
		it("拒绝 alg=none", async () => {
			const handler = new JWTHandler();
			const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
			const payload = b64url(JSON.stringify({ sub: "user" }));
			const token = `${header}.${payload}.`;
			const result = await handler.verifyJwt(token);
			expect(result).toBeNull();
		});

		it("拒绝 alg=None / alg=NONE / alg=''", async () => {
			const handler = new JWTHandler();
			for (const alg of ["None", "NONE", ""]) {
				const header = b64url(JSON.stringify({ alg: alg, typ: "JWT" }));
				const payload = b64url(JSON.stringify({ sub: "user" }));
				const token = `${header}.${payload}.fake`;
				const result = await handler.verifyJwt(token);
				expect(result).toBeNull();
			}
		});
	});

	describe("HMAC 路径 (HS256/HS384/HS512)", () => {
		it("未配置 hmacSecret 时拒绝 HS256 token", async () => {
			const handler = new JWTHandler("https://example.com/.well-known/jwks.json");
			const token = makeHS256({ sub: "user" }, "secret");
			const result = await handler.verifyJwt(token);
			expect(result).toBeNull();
		});

		it("配置 hmacSecret 后接受 HS256 token", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "shared-secret");
			const token = makeHS256({ sub: "user-1" }, "shared-secret");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
			expect(result?.claims.sub).toBe("user-1");
		});

		it("错误的 hmacSecret 拒绝", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "correct");
			const token = makeHS256({ sub: "user-1" }, "wrong");
			const result = await handler.verifyJwt(token);
			expect(result).toBeNull();
		});

		it("HS384 验签", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "secret384");
			const header = b64url(JSON.stringify({ alg: "HS384", typ: "JWT" }));
			const payload = b64url(JSON.stringify({ sub: "user-hs384" }));
			const sig = crypto.createHmac("sha384", "secret384").update(`${header}.${payload}`).digest();
			const token = `${header}.${payload}.${b64url(sig)}`;
			const result = await handler.verifyJwt(token);
			expect(result?.claims.sub).toBe("user-hs384");
		});
	});

	describe("exp / nbf 校验", () => {
		it("exp 过期拒绝", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s");
			const expired = Math.floor(Date.now() / 1000) - 60;
			const token = makeHS256({ sub: "user", exp: expired }, "s");
			expect(await handler.verifyJwt(token)).toBeNull();
		});

		it("nbf 未到时间拒绝", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s");
			const future = Math.floor(Date.now() / 1000) + 60;
			const token = makeHS256({ sub: "user", nbf: future }, "s");
			expect(await handler.verifyJwt(token)).toBeNull();
		});

		it("有效 exp/nbf 接受", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s");
			const exp = Math.floor(Date.now() / 1000) + 60;
			const token = makeHS256({ sub: "user", exp: exp }, "s");
			const result = await handler.verifyJwt(token);
			expect(result?.claims.sub).toBe("user");
		});
	});

	describe("iss / aud 校验 (JWT-002)", () => {
		it("iss 匹配时通过", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", undefined, "https://issuer.example.com");
			const token = makeHS256({ sub: "user", iss: "https://issuer.example.com" }, "s");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
		});

		it("iss 不匹配时拒绝", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", undefined, "https://issuer.example.com");
			const token = makeHS256({ sub: "user", iss: "https://attacker.example.com" }, "s");
			expect(await handler.verifyJwt(token)).toBeNull();
		});

		it("aud 字符串匹配时通过", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", "my-audience");
			const token = makeHS256({ sub: "user", aud: "my-audience" }, "s");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
		});

		it("aud 数组中包含期望值时通过", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", "expected-aud");
			const token = makeHS256({ sub: "user", aud: ["other", "expected-aud"] }, "s");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
		});

		it("aud 不匹配时拒绝", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", "my-audience");
			const token = makeHS256({ sub: "user", aud: "other-audience" }, "s");
			expect(await handler.verifyJwt(token)).toBeNull();
		});

		it("未配置 iss/aud 时不校验（向后兼容）", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s");
			const token = makeHS256({ sub: "user" }, "s");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
		});
	});

	describe("leeway 时钟漂移容忍 (JWT-002)", () => {
		it("leeway=30s 接受 exp 在 30s 内的已过期 token", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", undefined, undefined, 30);
			// exp 在 10s 前：未加 leeway 应拒绝，加 leeway=30s 应接受
			const exp = Math.floor(Date.now() / 1000) - 10;
			const token = makeHS256({ sub: "user", exp: exp }, "s");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
		});

		it("leeway=0 (默认) 拒绝已过期 token", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s");
			const exp = Math.floor(Date.now() / 1000) - 10;
			const token = makeHS256({ sub: "user", exp: exp }, "s");
			expect(await handler.verifyJwt(token)).toBeNull();
		});

		it("leeway 容忍 nbf 提前生效", async () => {
			const handler = new JWTHandler(undefined, undefined, 5 * 60 * 1000, "s", undefined, undefined, 30);
			// nbf 在 10s 后：未加 leeway 应拒绝（未到时间），加 leeway=30s 应接受
			const nbf = Math.floor(Date.now() / 1000) + 10;
			const token = makeHS256({ sub: "user", nbf: nbf }, "s");
			const result = await handler.verifyJwt(token);
			expect(result).not.toBeNull();
		});
	});

	describe("辅助方法", () => {
		it("isJwt 检测三段式", () => {
			expect(JWTHandler.isJwt("a.b.c")).toBe(true);
			expect(JWTHandler.isJwt("a.b")).toBe(false);
			expect(JWTHandler.isJwt("a.b.c.d")).toBe(false);
		});

		it("mapAlgorithm 返回 null 表示 alg=none", () => {
			expect(JWTHandler.mapAlgorithm("none")).toBeNull();
			expect(JWTHandler.mapAlgorithm("RS256")).toBe("RSA-SHA256");
			expect(JWTHandler.mapAlgorithm("HS256")).toBe("sha256");
			expect(JWTHandler.mapAlgorithm("unknown")).toBeNull();
		});

		it("isHmacAlgorithm / isPssAlgorithm / isEcAlgorithm 派发", () => {
			expect(JWTHandler.isHmacAlgorithm("HS256")).toBe(true);
			expect(JWTHandler.isHmacAlgorithm("RS256")).toBe(false);
			expect(JWTHandler.isPssAlgorithm("PS256")).toBe(true);
			expect(JWTHandler.isPssAlgorithm("RS256")).toBe(false);
			expect(JWTHandler.isEcAlgorithm("ES256")).toBe(true);
			expect(JWTHandler.isEcAlgorithm("RS256")).toBe(false);
		});
	});

	describe("非对称路径 (RS256 + JWKS)", () => {
		it("通过 JWKS 验证 RS256 token", async () => {
			const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
				modulusLength: 2048,
			}) as { publicKey: crypto.KeyObject; privateKey: crypto.KeyObject };
			// 用 publicKey.export 拿 JWK
			const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
			publicJwk.kid = "test-key";
			publicJwk.alg = "RS256";
			publicJwk.use = "sig";

			// 用 mock fetch 代替真实 HTTP 服务，避开 jest 30s 超时
			const jwksBody = JSON.stringify({ keys: [publicJwk] });
			const originalFetch = global.fetch;
			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => JSON.parse(jwksBody),
			}) as unknown as typeof fetch;

			try {
				const handler = new JWTHandler("https://example.com/jwks.json");
				const token = makeRS256({ sub: "user-rs" }, privateKey, publicJwk);
				const result = await handler.verifyJwt(token);
				expect(result).not.toBeNull();
				expect(result?.claims.sub).toBe("user-rs");
			} finally {
				global.fetch = originalFetch;
			}
		}, 10000);
	});

	describe("DIFF-AUTH-01: x5c 兜底 (PY handle_jwt.py:355-401)", () => {
		// 注：x5c 字段是 base64-DER 证书（非裸 SPKI）。生成真实自签证书需要 OpenSSL。
		// 这里只验证 _getX5cFallbackKey 单元行为：找到含 x5c 的 key 时返回 PEM，找不到返回 null。
		it("JWKS 含 x5c → _getX5cFallbackKey 返回 PEM 字符串", async () => {
			const x5cBase64 = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0ceBttPp" + "A".repeat(500);
			const jwksBody = JSON.stringify({
				keys: [
					{
						kty: "RSA",
						alg: "RS256",
						use: "sig",
						kid: "rotated-key",
						x5c: [x5cBase64],
					},
				],
			});

			const originalFetch = global.fetch;
			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => JSON.parse(jwksBody),
			}) as unknown as typeof fetch;

			try {
				const handler = new JWTHandler("https://example.com/jwks.json");
				const pem = await (handler as unknown as { _getX5cFallbackKey: () => Promise<string | null> })._getX5cFallbackKey();
				expect(pem).toContain("-----BEGIN CERTIFICATE-----");
				expect(pem).toContain(x5cBase64);
				expect(pem).toContain("-----END CERTIFICATE-----");
			} finally {
				global.fetch = originalFetch;
			}
		}, 10000);

		it("JWKS 无 x5c → _getX5cFallbackKey 返回 null", async () => {
			const jwksBody = JSON.stringify({
				keys: [
					{
						kty: "RSA",
						alg: "RS256",
						use: "sig",
						kid: "k-without-x5c",
					},
				],
			});

			const originalFetch = global.fetch;
			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => JSON.parse(jwksBody),
			}) as unknown as typeof fetch;

			try {
				const handler = new JWTHandler("https://example.com/jwks.json");
				const pem = await (handler as unknown as { _getX5cFallbackKey: () => Promise<string | null> })._getX5cFallbackKey();
				expect(pem).toBeNull();
			} finally {
				global.fetch = originalFetch;
			}
		}, 10000);

		it("kid 未命中 + JWKS 无 x5c → verifyJwt 返回 null (无兜底)", async () => {
			const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
			const jwk = publicKey.export({ format: "jwk" });
			const jwksBody = JSON.stringify({
				keys: [
					{
						...jwk,
						kid: "k-without-x5c",
						alg: "RS256",
					},
				],
			});

			const originalFetch = global.fetch;
			global.fetch = jest.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => JSON.parse(jwksBody),
			}) as unknown as typeof fetch;

			try {
				const handler = new JWTHandler("https://example.com/jwks.json");
				// token 用 JWKS 中不存在的 kid + 一个新私钥
				const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
				const token = makeRS256({ sub: "user-no-x5c" }, privateKey, { kid: "totally-unknown" });
				const result = await handler.verifyJwt(token);
				expect(result).toBeNull();
			} finally {
				global.fetch = originalFetch;
			}
		}, 10000);
	});

	describe("DIFF-AUTH-JWT-01: getNestedValue + 新增提取方法", () => {
		it("getNestedValue 嵌套路径访问", () => {
			expect(JWTHandler.getNestedValue({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
			expect(JWTHandler.getNestedValue({ a: { b: { c: 1 } } }, "a.b.x")).toBeUndefined();
			expect(JWTHandler.getNestedValue({}, "x")).toBeUndefined();
		});

		it("getUserId: 优先 sub > user_id > email > username", () => {
			const h = new JWTHandler();
			expect(h.getUserId({ sub: "s1" })).toBe("s1");
			expect(h.getUserId({ user_id: "u1" })).toBe("u1");
			expect(h.getUserId({ email: "e@x.com" })).toBe("e@x.com");
			expect(h.getUserId({ username: "usr" })).toBe("usr");
			expect(h.getUserId({ preferred_username: "pu" })).toBe("pu");
			expect(h.getUserId({})).toBeUndefined();
			expect(h.getUserId({}, "default")).toBe("default");
		});

		it("getUserEmail: 优先 email > user_email", () => {
			const h = new JWTHandler();
			expect(h.getUserEmail({ email: "a@b.com" })).toBe("a@b.com");
			expect(h.getUserEmail({ user_email: "c@d.com" })).toBe("c@d.com");
			expect(h.getUserEmail({}, "fallback@x")).toBe("fallback@x");
		});

		it("getUserRole: rbac_role > roles[0] > role", () => {
			const h = new JWTHandler();
			expect(h.getUserRole({ rbac_role: "admin" })).toBe("admin");
			expect(h.getUserRole({ roles: ["editor", "viewer"] })).toBe("editor");
			expect(h.getUserRole({ role: "user" })).toBe("user");
			expect(h.getUserRole({})).toBeUndefined();
		});

		it("getObjectId: object_id > oid", () => {
			const h = new JWTHandler();
			expect(h.getObjectId({ object_id: "o1" })).toBe("o1");
			expect(h.getObjectId({ oid: "o2" })).toBe("o2");
			expect(h.getObjectId({})).toBeUndefined();
			expect(h.getObjectId({}, "d")).toBe("d");
		});

		it("getTeamIds: teams[] > team_ids[]", () => {
			const h = new JWTHandler();
			expect(h.getTeamIds({ teams: ["t1", "t2"] })).toEqual(["t1", "t2"]);
			expect(h.getTeamIds({ team_ids: ["t3"] })).toEqual(["t3"]);
			expect(h.getTeamIds({ teams: ["t1", 42, "t2"] })).toEqual(["t1", "t2"]);
			expect(h.getTeamIds({})).toBeUndefined();
		});
	});
});
