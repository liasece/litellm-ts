import express from "express";
import request from "supertest";
import { createInternalUserRoutes } from "./InternalUserEndpoint";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { LiteLLM_ObjectPermissionTable } from "../db/schema/object-permissions";
import { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";

interface MockTables {
	readonly users: unknown[];
	readonly tokens?: unknown[];
	readonly objectPermissions?: unknown[];
	readonly memberships?: unknown[];
}

/**
 * 按 drizzle table 对象路由到对应 mock 数据集（/user/list 会一次查 4 张表做内存 join）。
 * @param tables
 * @param table
 */
function rowsForTable(tables: MockTables, table: unknown): unknown[] {
	if (table === LiteLLM_UserTable) {
		return tables.users;
	}
	if (table === LiteLLM_VerificationToken) {
		return tables.tokens ?? [];
	}
	if (table === LiteLLM_ObjectPermissionTable) {
		return tables.objectPermissions ?? [];
	}
	if (table === LiteLLM_OrganizationMembership) {
		return tables.memberships ?? [];
	}
	return [];
}

function makeApp(tables: MockTables): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const db = {
		select: () => ({
			from: (table: unknown) => Promise.resolve(rowsForTable(tables, table)),
		}),
	};
	createInternalUserRoutes(router, db as never, null);
	app.use(router);
	return app;
}

function makeUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		userId: "default_user_id",
		userAlias: null,
		teamId: null,
		ssoUserId: null,
		organizationId: null,
		objectPermissionId: null,
		password: null,
		teams: [],
		userRole: "proxy_admin",
		maxBudget: null,
		spend: 12.5,
		userEmail: "admin@example.com",
		models: [],
		metadata: {},
		maxParallelRequests: null,
		tpmLimit: null,
		rpmLimit: null,
		budgetDuration: null,
		budgetResetAt: null,
		allowedCacheControls: [],
		policies: [],
		modelSpend: {},
		modelMaxBudget: {},
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-02T00:00:00.000Z"),
		...overrides,
	};
}

/**
 * `/user/list` 契约测试锁定 Python LiteLLM WebUI 的 UserListResponse 形状。
 * 重点防止回退成旧 `{ success, data }` 包装，以及分页/过滤边界触发前端无限 loading。
 */
describe("InternalUserEndpoint /user/list 契约", () => {
	it("应返回 WebUI 期望的分页 shape，而不是 { success, data }", async () => {
		const app = makeApp({ users: [makeUser()] });

		const res = await request(app).get("/user/list?page=1&page_size=50");

		expect(res.status).toBe(200);
		expect(res.body.success).toBeUndefined();
		expect(res.body.data).toBeUndefined();
		expect(Array.isArray(res.body.users)).toBe(true);
		expect(res.body.total).toBe(1);
		expect(res.body.page).toBe(1);
		expect(res.body.page_size).toBe(50);
		expect(res.body.total_pages).toBe(1);
		// 严格锁定 Python /user/list 实测 21 键：不得附带 team_id/organization_id/policies/allowed_cache_controls/max_parallel_requests
		expect(Object.keys(res.body.users[0]).sort()).toEqual([
			"budget_duration",
			"budget_reset_at",
			"created_at",
			"key_count",
			"max_budget",
			"metadata",
			"model_max_budget",
			"model_spend",
			"models",
			"object_permission",
			"organization_memberships",
			"rpm_limit",
			"spend",
			"sso_user_id",
			"teams",
			"tpm_limit",
			"updated_at",
			"user_alias",
			"user_email",
			"user_id",
			"user_role",
		]);
		expect(res.body.users[0]).toMatchObject({
			user_id: "default_user_id",
			user_email: "admin@example.com",
			user_role: "proxy_admin",
			spend: 12.5,
			models: [],
			metadata: {},
		});
	});

	it("应补 Python 实测字段 key_count/model_spend/model_max_budget/object_permission/organization_memberships", async () => {
		const app = makeApp({
			users: [
				makeUser({ userId: "u1", objectPermissionId: "perm-1", modelSpend: { "gpt-4": 1.5 }, modelMaxBudget: { "gpt-4": 10 } }),
			],
			tokens: [
				{ token: "t1", userId: "u1", teamId: null },
				{ token: "t2", userId: "u1", teamId: "team-a" },
				{ token: "t3", userId: "u1", teamId: "litellm-dashboard" },
				{ token: "t4", userId: "u2", teamId: null },
			],
			objectPermissions: [
				{
					objectPermissionId: "perm-1",
					mcpServers: ["srv-a"],
					mcpAccessGroups: [],
					mcpToolPermissions: null,
					vectorStores: [],
					agents: [],
					agentAccessGroups: [],
				},
			],
			memberships: [
				{ userId: "u1", organizationId: "org-1", userRole: "member", spend: 2, budgetId: null, createdAt: null, updatedAt: null },
			],
		});

		const res = await request(app).get("/user/list?page=1&page_size=50");

		expect(res.status).toBe(200);
		const user = res.body.users[0];
		// key_count 排除 WebUI 登录会话 team（litellm-dashboard）的 key，对齐 Python get_user_key_counts
		expect(user.key_count).toBe(2);
		expect(user.model_spend).toEqual({ "gpt-4": 1.5 });
		expect(user.model_max_budget).toEqual({ "gpt-4": 10 });
		expect(user.object_permission).toMatchObject({ object_permission_id: "perm-1", mcp_servers: ["srv-a"] });
		expect(user.organization_memberships).toEqual([
			expect.objectContaining({ user_id: "u1", organization_id: "org-1", user_role: "member" }),
		]);
	});

	it("无关联数据时 key_count=0、object_permission/organization_memberships 为 null", async () => {
		const app = makeApp({ users: [makeUser()] });

		const res = await request(app).get("/user/list?page=1&page_size=50");

		expect(res.status).toBe(200);
		expect(res.body.users[0].key_count).toBe(0);
		expect(res.body.users[0].model_spend).toEqual({});
		expect(res.body.users[0].model_max_budget).toEqual({});
		expect(res.body.users[0].object_permission).toBeNull();
		expect(res.body.users[0].organization_memberships).toBeNull();
	});

	it("空用户列表也应返回稳定分页 shape", async () => {
		const app = makeApp({ users: [] });

		const res = await request(app).get("/user/list?page=2&page_size=10");

		expect(res.status).toBe(200);
		expect(res.body.users).toEqual([]);
		expect(res.body.total).toBe(0);
		expect(res.body.page).toBe(2);
		expect(res.body.page_size).toBe(10);
		expect(res.body.total_pages).toBe(1);
	});

	it("应支持 WebUI 传入的过滤参数且不破坏 shape", async () => {
		const app = makeApp({
			users: [
				makeUser({ userId: "u1", userEmail: "alice@example.com", userRole: "internal_user", teamId: "team-a" }),
				makeUser({ userId: "u2", userEmail: "bob@example.com", userRole: "proxy_admin", teamId: "team-b" }),
			],
		});

		const res = await request(app).get(
			"/user/list?page=1&page_size=50&user_ids=u1,u2&user_email=alice&role=internal_user&team=team-a&sort_by=user_email&sort_order=desc",
		);

		expect(res.status).toBe(200);
		expect(Array.isArray(res.body.users)).toBe(true);
		expect(res.body.users).toHaveLength(1);
		expect(res.body.users[0].user_id).toBe("u1");
		expect(res.body.total).toBe(1);
		expect(res.body.total_pages).toBe(1);
	});

	it("应处理分页、排序与 page_size 边界", async () => {
		const app = makeApp({
			users: [
				makeUser({ userId: "u1", spend: 3, userEmail: "c@example.com" }),
				makeUser({ userId: "u2", spend: 1, userEmail: "b@example.com" }),
				makeUser({ userId: "u3", spend: 2, userEmail: "a@example.com" }),
			],
		});

		const res = await request(app).get("/user/list?page=2&page_size=2&sort_by=spend&sort_order=asc");

		expect(res.status).toBe(200);
		expect(res.body.users.map((user: { user_id: string }) => user.user_id)).toEqual(["u1"]);
		expect(res.body.total).toBe(3);
		expect(res.body.page).toBe(2);
		expect(res.body.page_size).toBe(2);
		expect(res.body.total_pages).toBe(2);
	});

	it("非法 sort_by 应回退 user_id，非法 page_size 应回退默认值", async () => {
		const app = makeApp({ users: [makeUser({ userId: "b" }), makeUser({ userId: "a" })] });

		const res = await request(app).get("/user/list?page=1&page_size=0&sort_by=unknown&sort_order=desc");

		expect(res.status).toBe(200);
		expect(res.body.page_size).toBe(50);
		expect(res.body.users.map((user: { user_id: string }) => user.user_id)).toEqual(["b", "a"]);
	});

	it("user_email 过滤应大小写不敏感，越界页应返回空 users 但保留 total", async () => {
		const app = makeApp({ users: [makeUser({ userId: "u1", userEmail: "Alice@Example.com" })] });

		const res = await request(app).get("/user/list?page=99&page_size=10&user_email=alice");

		expect(res.status).toBe(200);
		expect(res.body.users).toEqual([]);
		expect(res.body.total).toBe(1);
		expect(res.body.total_pages).toBe(1);
	});
});

describe("InternalUserEndpoint /user/new 契约", () => {
	function makeUserNewApp(existingUserIds: string[]): { app: express.Express; inserted: Record<string, unknown>[] } {
		const inserted: Record<string, unknown>[] = [];
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const db = {
			select: () => ({
				from: () => ({
					// mock 不解析 drizzle 条件对象：直接返回既有用户集，由测试场景决定是否有重复
					where: () => ({
						limit: (n: number) => Promise.resolve(existingUserIds.slice(0, n).map((userId) => ({ userId: userId }))),
					}),
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => {
					inserted.push(values);
					return Promise.resolve();
				},
			}),
		};
		createInternalUserRoutes(router, db as never, null);
		app.use(router);
		return { app: app, inserted: inserted };
	}

	it("返回 Python NewUserResponse 完整字段集（GenerateKeyResponse 48 键 + 用户字段），并同步生成 key", async () => {
		const { app, inserted } = makeUserNewApp([]);

		const res = await request(app).post("/user/new").send({ user_id: "u-new", user_alias: "alias-u", max_budget: 7 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBeUndefined();
		// GenerateKeyResponse 关键字段
		expect(res.body.user_id).toBe("u-new");
		expect(res.body.max_budget).toBe(7);
		expect(res.body.key).toMatch(/^sk-/);
		expect(res.body.key_name).toBe(`sk-...${(res.body.key as string).slice(-4)}`);
		// Python 实测：token_id/token/created_by/updated_by 均为 null
		expect(res.body.token_id).toBeNull();
		expect(res.body.token).toBeNull();
		expect(res.body.created_by).toBeNull();
		expect(res.body.updated_by).toBeNull();
		// 附加用户字段
		expect(res.body.user_alias).toBe("alias-u");
		expect(res.body).toHaveProperty("user_email");
		expect(res.body).toHaveProperty("user_role");
		expect(res.body).toHaveProperty("teams");
		expect(res.body).toHaveProperty("router_settings");
		// 落库：用户行 + key 行（key 关联 userId，createdBy 为 null 对齐 Python）
		expect(inserted[0]?.userId).toBe("u-new");
		expect(inserted[1]?.userId).toBe("u-new");
		expect(inserted[1]?.token).toHaveLength(64);
		expect(inserted[1]?.createdBy).toBeNull();
	});

	it("user_id 缺省时自动生成 uuid（对齐 Python _update_internal_new_user_params）", async () => {
		const { app, inserted } = makeUserNewApp([]);

		const res = await request(app).post("/user/new").send({ user_email: "a@example.com" });

		expect(res.status).toBe(200);
		expect(res.body.user_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(res.body.user_email).toBe("a@example.com");
		expect(inserted[0]?.userId).toBe(res.body.user_id);
	});

	it("user_id 已提供时按原值创建；重复时返回 409", async () => {
		const { app, inserted } = makeUserNewApp(["existing-user"]);

		const res = await request(app).post("/user/new").send({ user_id: "existing-user" });
		expect(res.status).toBe(409);
		expect(inserted).toHaveLength(0);

		const { app: app2, inserted: inserted2 } = makeUserNewApp([]);
		const res2 = await request(app2).post("/user/new").send({ user_id: "new-user" });
		expect(res2.status).toBe(200);
		expect(res2.body.user_id).toBe("new-user");
		expect(inserted2[0]?.userId).toBe("new-user");
	});
});

describe("InternalUserEndpoint /user/update、/user/delete、/user/info 契约", () => {
	const USER_ROW = {
		userId: "u-1",
		userAlias: "alias-1",
		teamId: null,
		ssoUserId: null,
		organizationId: null,
		objectPermissionId: null,
		password: null,
		teams: [],
		userRole: "internal_user",
		maxBudget: 9,
		spend: 0,
		userEmail: "u1@example.com",
		models: [],
		metadata: {},
		maxParallelRequests: null,
		tpmLimit: null,
		rpmLimit: null,
		budgetDuration: null,
		budgetResetAt: null,
		allowedCacheControls: [],
		policies: [],
		modelSpend: {},
		modelMaxBudget: {},
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-02T00:00:00.000Z"),
	};
	const TOKEN_ROW = {
		token: "hashed-token-1",
		keyName: "sk-...abcd",
		keyAlias: null,
		userId: "u-1",
		teamId: null,
		models: [],
		metadata: {},
		blocked: null,
	};

	const USER_INFO_DATA_FIELDS = [
		"user_id",
		"user_alias",
		"team_id",
		"sso_user_id",
		"organization_id",
		"object_permission_id",
		"password",
		"teams",
		"user_role",
		"max_budget",
		"spend",
		"user_email",
		"models",
		"metadata",
		"max_parallel_requests",
		"tpm_limit",
		"rpm_limit",
		"budget_duration",
		"budget_reset_at",
		"allowed_cache_controls",
		"policies",
		"model_spend",
		"model_max_budget",
		"created_at",
		"updated_at",
		"litellm_organization_table",
		"organization_memberships",
		"invitations_created",
		"invitations_updated",
		"invitations_user",
		"object_permission",
	];

	/**
	 * 构造支持 where/limit 链式调用的多表 mock db。
	 * @param tables
	 * @param deletedCounts
	 */
	function makeCrudApp(tables: MockTables, deletedCounts: number[] = []): express.Express {
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const db = {
			select: () => ({
				from: (table: unknown) => ({
					where: () => {
						const rows = rowsForTable(tables, table);
						const promise = Promise.resolve(rows) as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
						promise.limit = (n: number) => Promise.resolve(rows.slice(0, n));
						return promise;
					},
				}),
			}),
			update: () => ({
				set: () => ({
					where: () => Promise.resolve({ rowCount: 1 }),
					returning: () => Promise.resolve([USER_ROW]),
				}),
			}),
			delete: () => ({
				where: () => {
					deletedCounts.push(1);
					return Promise.resolve({ rowCount: 1 });
				},
			}),
		};
		createInternalUserRoutes(router, db as never, null);
		app.use(router);
		return app;
	}

	it("/user/update 返回 { user_id, data: 31 键用户对象 }，organization_memberships 为 null", async () => {
		const app = makeCrudApp({ users: [USER_ROW] });

		const res = await request(app).post("/user/update").send({ user_id: "u-1", max_budget: 9 });

		expect(res.status).toBe(200);
		expect(res.body.user_id).toBe("u-1");
		expect(Object.keys(res.body.data).sort()).toEqual([...USER_INFO_DATA_FIELDS].sort());
		expect(res.body.data.organization_memberships).toBeNull();
		expect(res.body.data.max_budget).toBe(9);
		expect(res.body.data.user_email).toBe("u1@example.com");
	});

	it("/user/delete 按 user_ids 删除并返回裸整数计数", async () => {
		const app = makeCrudApp({ users: [USER_ROW] });

		const res = await request(app)
			.post("/user/delete")
			.send({ user_ids: ["u-1"] });

		expect(res.status).toBe(200);
		expect(res.body).toBe(1);

		const missing = await request(app).post("/user/delete").send({});
		expect(missing.status).toBe(400);
	});

	it("/user/info 返回 { user_id, user_info(31 键), keys(含 team_alias), teams }", async () => {
		const app = makeCrudApp({ users: [USER_ROW], tokens: [TOKEN_ROW] });

		const res = await request(app).get("/user/info?user_id=u-1");

		expect(res.status).toBe(200);
		expect(res.body.user_id).toBe("u-1");
		expect(Object.keys(res.body.user_info).sort()).toEqual([...USER_INFO_DATA_FIELDS].sort());
		// /user/info 实测：organization_memberships 为空数组（非 null）
		expect(res.body.user_info.organization_memberships).toEqual([]);
		expect(res.body.keys).toHaveLength(1);
		expect(res.body.keys[0].token).toBe("hashed-token-1");
		// key 无 team_id 时 team_alias 为字符串 "None"（对齐 Python str(None)）
		expect(res.body.keys[0].team_alias).toBe("None");
		expect(res.body.keys[0]).toHaveProperty("jwt_key_mappings");
		expect(res.body.teams).toEqual([]);
	});
});
