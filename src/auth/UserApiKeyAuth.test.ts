/**
 * UserApiKeyAuth 认证中间件测试
 */
import type { Request } from "express";
import { extractApiKey, parseCookieToken } from "./UserApiKeyAuth";
import { hashApiKey } from "../core/utils/crypto";

function mkReq(headers: Record<string, string>): Request {
	return { headers: headers } as Request;
}

describe("UserApiKeyAuth", () => {
	describe("parseCookieToken — 长度上限防止超长输入", () => {
		it("正常 token 可解析", () => {
			expect(parseCookieToken("token=abc.def.ghi")).toBe("abc.def.ghi");
		});

		it("空 cookie 头返回 null", () => {
			expect(parseCookieToken(undefined)).toBeNull();
			expect(parseCookieToken("")).toBeNull();
		});

		it("无 token 字段返回 null", () => {
			expect(parseCookieToken("foo=bar; baz=qux")).toBeNull();
		});

		it("超长 token 值返回 null（避免超长输入进入鉴权路径）", () => {
			const longValue = "a".repeat(5000);
			expect(parseCookieToken(`token=${longValue}`)).toBeNull();
		});

		it("空 token 值返回 null", () => {
			expect(parseCookieToken("token=")).toBeNull();
		});
	});

	describe("extractApiKey", () => {
		it("extracts from Bearer token", () => {
			const req = mkReq({ authorization: "Bearer sk-test-key-123" });
			expect(extractApiKey(req)).toBe("sk-test-key-123");
		});

		it("extracts from x-api-key header", () => {
			const req = mkReq({ "x-api-key": "sk-my-key" });
			expect(extractApiKey(req)).toBe("sk-my-key");
		});

		it("extracts from x-litellm-key header", () => {
			const req = mkReq({ "x-litellm-key": "sk-litellm-key" });
			expect(extractApiKey(req)).toBe("sk-litellm-key");
		});

		it("prefers Authorization Bearer over x-api-key", () => {
			const req = mkReq({ authorization: "Bearer sk-bearer", "x-api-key": "sk-header" });
			expect(extractApiKey(req)).toBe("sk-bearer");
		});

		it("returns null when no key present", () => {
			const req = mkReq({});
			expect(extractApiKey(req)).toBeNull();
		});

		it("ignores empty x-api-key", () => {
			const req = mkReq({ "x-api-key": "" });
			expect(extractApiKey(req)).toBeNull();
		});
	});

	describe("hashApiKey", () => {
		it("produces consistent SHA-256 hash", () => {
			const h1 = hashApiKey("test-key");
			const h2 = hashApiKey("test-key");
			expect(h1).toBe(h2);
			expect(h1).toHaveLength(64);
		});

		it("produces different hashes for different keys", () => {
			expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
		});
	});

	describe("master key 直通分支", () => {
		/**
		 * 对齐 PY user_api_key_auth.py:1073-1085 — master key 认证通过时
		 * user_role=LitellmUserRoles.PROXY_ADMIN，使 /get/config/callbacks、
		 * /model/cost_map/source 等 admin 端点对 master key 放行。
		 */
		it("master key 明文匹配 → req.auth.user_role = proxy_admin", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jest.fn(),
				findTeamById: jest.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const middleware = createApiKeyAuth(repo, "sk-master-key");
			const req = mkReq({ "x-api-key": "sk-master-key" });
			await new Promise<void>((resolve) => {
				middleware(req, {} as never, () => resolve());
			});
			expect(req.auth?.user_role).toBe("proxy_admin");
			expect(req.auth?.team_id).toBeUndefined();
			// master key 直通分支不应触达 DB
			expect(repo.findVerificationTokenByHash).not.toHaveBeenCalled();
		});

		it("master key 哈希匹配（传入哈希后的 master key）→ user_role = proxy_admin", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jest.fn(),
				findTeamById: jest.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			// PY 第二分支：masterKey 配置为哈希值，明文 key 哈希后与之比较。
			// 外层长度门槛要求 apiKey.length === masterKey.length（64），故明文 key 取 64 字符。
			const plainKey = `sk-${"a".repeat(61)}`;
			const hashedMaster = hashApiKey(plainKey);
			const middleware = createApiKeyAuth(repo, hashedMaster);
			const req = mkReq({ "x-api-key": plainKey });
			await new Promise<void>((resolve) => {
				middleware(req, {} as never, () => resolve());
			});
			expect(req.auth?.user_role).toBe("proxy_admin");
		});
	});

	describe("DIFF-AUTH-02: 过期边界测试 (UTC 显式比较)", () => {
		// 用 mock 构造 AuthRepository 验证 expiry 边界
		it("expiryMs - nowMs === 0 → 判过期（严格 <）", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const expires = new Date(Date.now()); // 当前时间
			const token = {
				token: "hashed-key",
				userId: "u1",
				teamId: null,
				organizationId: null,
				keyAlias: null,
				models: null,
				spend: 0,
				maxBudget: null,
				tpmLimit: null,
				rpmLimit: null,
				metadata: null,
				blocked: false,
				permissions: null,
				budgetResetAt: null,
				expires: expires,
				keyName: null,
				allowedRoutes: null,
				modelSpend: null,
				modelMaxBudget: null,
				budgetId: null,
				lastActive: null,
				maxParallelRequests: null,
				cooldownTime: null,
			};
			const repo = {
				findVerificationTokenByHash: jest.fn().mockResolvedValue(token),
				findTeamById: jest.fn(),
				findUserById: jest.fn().mockResolvedValue(null),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const middleware = createApiKeyAuth(repo);
			const req = mkReq({ "x-api-key": "sk-test" });
			const next = jest.fn();
			await new Promise<void>((resolve) => {
				middleware(req, {} as never, (err) => {
					resolve();
					expect(err).toBeDefined();
				});
			});
			expect(next).not.toHaveBeenCalled();
		});

		it("future expiry (1h 后) → 通过校验", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const expires = new Date(Date.now() + 3_600_000);
			const token = {
				token: "hashed-key",
				userId: "u1",
				teamId: null,
				organizationId: null,
				keyAlias: null,
				models: null,
				spend: 0,
				maxBudget: null,
				tpmLimit: null,
				rpmLimit: null,
				metadata: null,
				blocked: false,
				permissions: null,
				budgetResetAt: null,
				expires: expires,
				keyName: null,
				allowedRoutes: null,
				modelSpend: null,
				modelMaxBudget: null,
				budgetId: null,
				lastActive: null,
				maxParallelRequests: null,
				cooldownTime: null,
			};
			const repo = {
				findVerificationTokenByHash: jest.fn().mockResolvedValue(token),
				findTeamById: jest.fn(),
				findUserById: jest.fn().mockResolvedValue(null),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const middleware = createApiKeyAuth(repo);
			const req = mkReq({ "x-api-key": "sk-test" });
			const err: unknown[] = [];
			await new Promise<void>((resolve) => {
				middleware(req, {} as never, (e) => {
					err.push(e);
					resolve();
				});
			});
			expect(err[0]).toBeUndefined();
			expect(req.auth).toBeDefined();
		});

		it("past expiry (1h 前) → 401", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const expires = new Date(Date.now() - 3_600_000);
			const token = {
				token: "hashed-key",
				userId: "u1",
				teamId: null,
				organizationId: null,
				keyAlias: null,
				models: null,
				spend: 0,
				maxBudget: null,
				tpmLimit: null,
				rpmLimit: null,
				metadata: null,
				blocked: false,
				permissions: null,
				budgetResetAt: null,
				expires: expires,
				keyName: null,
				allowedRoutes: null,
				modelSpend: null,
				modelMaxBudget: null,
				budgetId: null,
				lastActive: null,
				maxParallelRequests: null,
				cooldownTime: null,
			};
			const repo = {
				findVerificationTokenByHash: jest.fn().mockResolvedValue(token),
				findTeamById: jest.fn(),
				findUserById: jest.fn().mockResolvedValue(null),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const middleware = createApiKeyAuth(repo);
			const req = mkReq({ "x-api-key": "sk-test" });
			const next = jest.fn();
			await new Promise<void>((resolve) => {
				middleware(req, {} as never, (err) => {
					resolve();
					expect(err).toBeDefined();
				});
			});
			expect(next).not.toHaveBeenCalled();
		});
	});
});
