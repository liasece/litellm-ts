/**
 * UserApiKeyAuth 认证中间件测试
 */
import { jest as jestGlobals } from "@jest/globals";
import type { Request } from "express";

// Jest 30 的严格 mock 泛型无法从 Drizzle 推导返回类型；测试仓库均为最小结构 mock。
const jestMock = jestGlobals as any;
import type { createApiKeyAuth } from "./UserApiKeyAuth";
import { extractApiKey, parseCookieToken, webUiCsrfProtection } from "./UserApiKeyAuth";
import { hashApiKey } from "../core/utils/crypto";

function mkReq(headers: Record<string, string>): Request {
	return { headers: headers } as Request;
}

function makeToken(overrides: Record<string, unknown> = {}) {
	return {
		token: "hashed-key",
		userId: null,
		teamId: null,
		organizationId: null,
		keyAlias: null,
		models: [],
		spend: 0,
		maxBudget: null,
		tpmLimit: null,
		rpmLimit: null,
		metadata: null,
		blocked: false,
		permissions: null,
		budgetResetAt: null,
		expires: null,
		keyName: null,
		allowedRoutes: null,
		modelSpend: null,
		modelMaxBudget: null,
		budgetId: null,
		lastActive: null,
		maxParallelRequests: null,
		...overrides,
	};
}

async function runMiddleware(middleware: ReturnType<typeof createApiKeyAuth>, req: Request): Promise<unknown> {
	return new Promise((resolve) => {
		middleware(req, {} as never, (error) => resolve(error));
	});
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

		it("malformed percent-encoded token 返回 null 而非抛异常", () => {
			expect(parseCookieToken("token=%E0%A4%A")).toBeNull();
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

		it.each(["/v1beta/models/gemini:generateContent", "/v1beta/models/gemini:streamGenerateContent"])(
			"extracts query key for Google route %s",
			(route) => {
				const req = mkReq({});
				req.query = { key: "google-query-key" };

				expect(extractApiKey(req, undefined, route)).toBe("google-query-key");
			},
		);

		it("does not use query key as authentication on ordinary routes", () => {
			const req = mkReq({});
			req.query = { key: "lookup-target-hash" };

			expect(extractApiKey(req, undefined, "/key/info")).toBeNull();
		});
	});

	describe("WebUI cookie session", () => {
		const sessionClaims = {
			user_id: "default_user_id",
			user_role: "proxy_admin",
			login_method: "username_password",
			webui_session: true,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
			jti: "session-jti",
		};

		it("有效 JWT 与活动 DB session 应认证为 proxy_admin，且不需要浏览器 bearer key", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repository = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(
					makeToken({
						token: hashApiKey("session-jti"),
						userId: "default_user_id",
						teamId: "litellm-dashboard",
						expires: new Date(Date.now() + 3600_000),
						metadata: { webui_session: true },
					}),
				),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const jwtHandler = {
				verifyJwt: jestMock.fn().mockResolvedValue({ claims: sessionClaims }),
			} as unknown as Parameters<typeof createApiKeyAuth>[2];
			const middleware = createApiKeyAuth(repository, "master-key", jwtHandler);
			const req = mkReq({ cookie: "token=header.payload.signature" });

			const error = await runMiddleware(middleware, req);

			expect(error).toBeUndefined();
			expect(repository.findVerificationTokenByHash).toHaveBeenCalledWith(hashApiKey("session-jti"));
			expect(req.auth).toMatchObject({
				user_id: "default_user_id",
				user_role: "proxy_admin",
				team_id: "litellm-dashboard",
			});
			expect(req.auth?.api_key).toBe(hashApiKey("session-jti"));
		});

		it("/key/info query key 不应覆盖有效 cookie session", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repository = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(
					makeToken({
						token: hashApiKey("session-jti"),
						userId: "default_user_id",
						teamId: "litellm-dashboard",
						expires: new Date(Date.now() + 3600_000),
						metadata: { webui_session: true },
					}),
				),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const verifyJwt = jestMock.fn().mockResolvedValue({ claims: sessionClaims });
			const jwtHandler = { verifyJwt: verifyJwt } as unknown as NonNullable<Parameters<typeof createApiKeyAuth>[2]>;
			const middleware = createApiKeyAuth(repository, "master-key", jwtHandler);
			const req = {
				headers: { cookie: "token=header.payload.signature" },
				path: "/key/info",
				query: { key: "spend-log-token-hash" },
			} as unknown as Request;

			const error = await runMiddleware(middleware, req);

			expect(error).toBeUndefined();
			expect(verifyJwt).toHaveBeenCalledWith("header.payload.signature");
			expect(repository.findVerificationTokenByHash).toHaveBeenCalledTimes(1);
			expect(repository.findVerificationTokenByHash).toHaveBeenCalledWith(hashApiKey("session-jti"));
			expect(repository.findVerificationTokenByHash).not.toHaveBeenCalledWith(hashApiKey("spend-log-token-hash"));
		});

		it("缺少 DB session 的 cookie JWT 应被拒绝", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repository = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(null),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const jwtHandler = {
				verifyJwt: jestMock.fn().mockResolvedValue({ claims: sessionClaims }),
			} as unknown as Parameters<typeof createApiKeyAuth>[2];
			const middleware = createApiKeyAuth(repository, "master-key", jwtHandler);

			const error = await runMiddleware(middleware, mkReq({ cookie: "token=header.payload.signature" }));

			expect(error).toMatchObject({ statusCode: 401 });
		});

		it("cookie session 写请求缺少匹配 CSRF token 应返回 403", async () => {
			const req = mkReq({ cookie: "token=session; litellm_csrf_token=csrf-cookie" });
			req.method = "POST";
			req.auth = { api_key: "stored-session-hash", metadata: { webui_session: true } };

			const error = await runMiddleware(webUiCsrfProtection, req);

			expect(error).toMatchObject({ statusCode: 403 });
		});

		it("普通 API key 写请求不受 cookie CSRF 校验影响", async () => {
			const req = mkReq({ authorization: "Bearer sk-client" });
			req.method = "POST";
			req.auth = { api_key: "sk-client" };

			const error = await runMiddleware(webUiCsrfProtection, req);

			expect(error).toBeUndefined();
		});

		it("显式 bearer API key 应优先于 cookie session 并保持原有客户端兼容", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repository = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(makeToken({ token: hashApiKey("sk-client") })),
				findDeprecatedVerificationTokenByHash: jestMock.fn(),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const jwtHandler = { verifyJwt: jestMock.fn() } as unknown as Parameters<typeof createApiKeyAuth>[2];
			const middleware = createApiKeyAuth(repository, "master-key", jwtHandler);
			const req = mkReq({ authorization: "Bearer sk-client", cookie: "token=header.payload.signature" });

			const error = await runMiddleware(middleware, req);

			expect(error).toBeUndefined();
			expect(jwtHandler!.verifyJwt).not.toHaveBeenCalled();
			expect(req.auth?.api_key).toBe("sk-client");
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
				findVerificationTokenByHash: jestMock.fn(),
				findTeamById: jestMock.fn(),
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
				findVerificationTokenByHash: jestMock.fn(),
				findTeamById: jestMock.fn(),
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
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(token),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn().mockResolvedValue(null),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const middleware = createApiKeyAuth(repo);
			const req = mkReq({ "x-api-key": "sk-test" });
			const next = jestMock.fn();
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
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(token),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn().mockResolvedValue(null),
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
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(token),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn().mockResolvedValue(null),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const middleware = createApiKeyAuth(repo);
			const req = mkReq({ "x-api-key": "sk-test" });
			const next = jestMock.fn();
			await new Promise<void>((resolve) => {
				middleware(req, {} as never, (err) => {
					resolve();
					expect(err).toBeDefined();
				});
			});
			expect(next).not.toHaveBeenCalled();
		});
	});

	describe("数据库 token 状态与 deprecated token 回退", () => {
		it("active token blocked 时在进入下游前返回 401", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(makeToken({ blocked: true })),
				findDeprecatedVerificationTokenByHash: jestMock.fn(),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-blocked" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toMatchObject({ statusCode: 401 });
			expect(req.auth).toBeUndefined();
			expect(repo.findTeamById).not.toHaveBeenCalled();
			expect(repo.findUserById).not.toHaveBeenCalled();
		});

		it("active 查找失败时，有效 deprecated token 按 activeTokenId 加载并认证", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const apiKey = "sk-rotated";
			const tokenHash = hashApiKey(apiKey);
			const activeTokenId = "active-token-hash";
			const findDeprecatedVerificationTokenByHash = jestMock.fn().mockResolvedValue({
				token: tokenHash,
				activeTokenId: activeTokenId,
				revokeAt: new Date(Date.now() + 60_000),
			});
			const repo = {
				findVerificationTokenByHash: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(makeToken({ token: activeTokenId })),
				findDeprecatedVerificationTokenByHash: findDeprecatedVerificationTokenByHash,
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": apiKey });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toBeUndefined();
			expect(repo.findVerificationTokenByHash).toHaveBeenNthCalledWith(1, tokenHash);
			expect(findDeprecatedVerificationTokenByHash).toHaveBeenCalledWith(tokenHash);
			expect(repo.findVerificationTokenByHash).toHaveBeenNthCalledWith(2, activeTokenId);
			expect(req.auth?.token).toBe(activeTokenId);
		});

		it("deprecated token 的 revokeAt 已到期时返回 401", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const findDeprecatedVerificationTokenByHash = jestMock.fn().mockResolvedValue({
				token: "deprecated-hash",
				activeTokenId: "active-token-hash",
				revokeAt: new Date(Date.now() - 1),
			});
			const repo = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(null),
				findDeprecatedVerificationTokenByHash: findDeprecatedVerificationTokenByHash,
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-revoked" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toMatchObject({ statusCode: 401 });
			expect(findDeprecatedVerificationTokenByHash).toHaveBeenCalledWith(hashApiKey("sk-revoked"));
			expect(repo.findVerificationTokenByHash).toHaveBeenCalledTimes(1);
			expect(req.auth).toBeUndefined();
		});

		it("deprecated 指向的 active token blocked 时返回 401", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(makeToken({ token: "active-token-hash", blocked: true })),
				findDeprecatedVerificationTokenByHash: jestMock.fn().mockResolvedValue({
					token: "deprecated-hash",
					activeTokenId: "active-token-hash",
					revokeAt: new Date(Date.now() + 60_000),
				}),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-rotated-blocked" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toMatchObject({ statusCode: 401 });
			expect(repo.findVerificationTokenByHash).toHaveBeenCalledTimes(2);
			expect(req.auth).toBeUndefined();
		});

		it("deprecated 指向的 active token expired 时返回 401", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(makeToken({ token: "active-token-hash", expires: new Date(Date.now() - 1) })),
				findDeprecatedVerificationTokenByHash: jestMock.fn().mockResolvedValue({
					token: "deprecated-hash",
					activeTokenId: "active-token-hash",
					revokeAt: new Date(Date.now() + 60_000),
				}),
				findTeamById: jestMock.fn(),
				findUserById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-rotated-expired" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toMatchObject({ statusCode: 401 });
			expect(repo.findVerificationTokenByHash).toHaveBeenCalledTimes(2);
			expect(req.auth).toBeUndefined();
		});
	});

	describe("独立预算快照", () => {
		it("关键认证账务查询失败转换为 503", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jestMock.fn().mockRejectedValue(new Error("database unavailable")),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];

			const error = await runMiddleware(createApiKeyAuth(repo), mkReq({ "x-api-key": "sk-db-failure" }));

			expect(error).toMatchObject({ statusCode: 503 });
		});

		it("key 与 end-user 的 budget_id 解析为 BudgetTable 上限", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const findBudgetById = jestMock.fn((budgetId: string) =>
				Promise.resolve(budgetId === "key-budget" ? { max_budget: 11 } : { max_budget: 7 }),
			);
			const repo = {
				findVerificationTokenByHash: jestMock
					.fn()
					.mockResolvedValue(makeToken({ token: "key-hash", budgetId: "key-budget", maxBudget: null })),
				findDeprecatedVerificationTokenByHash: jestMock.fn(),
				findEndUserById: jestMock.fn().mockResolvedValue({
					userId: "end-user",
					alias: null,
					spend: 2,
					allowedModelRegion: null,
					defaultModel: null,
					budgetId: "end-user-budget",
					objectPermissionId: null,
					blocked: false,
				}),
				findBudgetById: findBudgetById,
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-budget-id", "x-end-user-id": "end-user" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toBeUndefined();
			expect(req.auth?.budget_snapshots).toMatchObject({
				key: { id: "key-hash", max_budget: 11, budget_id: "key-budget" },
				end_user: { id: "end-user", max_budget: 7, budget_id: "end-user-budget" },
			});
			expect(findBudgetById).toHaveBeenCalledWith("key-budget");
			expect(findBudgetById).toHaveBeenCalledWith("end-user-budget");
		});

		it("EndUser 无 budget_id 时按无限额认证", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jestMock.fn().mockResolvedValue(makeToken({ token: "key-hash" })),
				findDeprecatedVerificationTokenByHash: jestMock.fn(),
				findEndUserById: jestMock.fn().mockResolvedValue({
					userId: "end-user-no-budget",
					alias: null,
					spend: 2,
					allowedModelRegion: null,
					defaultModel: null,
					budgetId: null,
					objectPermissionId: null,
					blocked: false,
				}),
				findBudgetById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-no-end-user-budget", "x-end-user-id": "end-user-no-budget" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toBeUndefined();
			expect(req.auth?.budget_snapshots?.end_user).toMatchObject({
				id: "end-user-no-budget",
				spend: 2,
				max_budget: null,
			});
			expect(repo.findBudgetById).not.toHaveBeenCalled();
		});

		it("key 与 team spend 不再合并，并保留各自预算", async () => {
			const { createApiKeyAuth } = await import("./UserApiKeyAuth");
			const repo = {
				findVerificationTokenByHash: jestMock
					.fn()
					.mockResolvedValue(makeToken({ token: "key-hash", userId: "user-1", teamId: "team-1", spend: 2, maxBudget: 5 })),
				findDeprecatedVerificationTokenByHash: jestMock.fn(),
				findTeamById: jestMock.fn().mockResolvedValue({
					teamId: "team-1",
					spend: 7,
					maxBudget: 20,
					blocked: false,
					metadata: {},
				}),
				findUserById: jestMock.fn().mockResolvedValue({ userId: "user-1", spend: 3, maxBudget: 9, userRole: "internal_user" }),
				findTeamMembership: jestMock.fn().mockResolvedValue(null),
				findOrganizationById: jestMock.fn(),
				findProjectById: jestMock.fn(),
				findEndUserById: jestMock.fn(),
				findBudgetById: jestMock.fn(),
			} as unknown as Parameters<typeof createApiKeyAuth>[0];
			const req = mkReq({ "x-api-key": "sk-budget" });

			const error = await runMiddleware(createApiKeyAuth(repo), req);

			expect(error).toBeUndefined();
			expect(req.auth?.spend).toBe(2);
			expect(req.auth?.max_budget).toBe(5);
			expect(req.auth?.budget_snapshots).toMatchObject({
				key: { id: "key-hash", spend: 2, max_budget: 5 },
				team: { id: "team-1", spend: 7, max_budget: 20 },
				user: { id: "user-1", spend: 3, max_budget: 9 },
			});
		});
	});
});
