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
