import express from "express";
import request from "supertest";
import { createInternalUserRoutes } from "./InternalUserEndpoint";

interface SelectChain {
	readonly from: () => Promise<unknown[]>;
}

function makeApp(rows: unknown[]): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const db = {
		select: (): SelectChain => ({
			from: () => Promise.resolve(rows),
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
		const app = makeApp([makeUser()]);

		const res = await request(app).get("/user/list?page=1&page_size=50");

		expect(res.status).toBe(200);
		expect(res.body.success).toBeUndefined();
		expect(res.body.data).toBeUndefined();
		expect(Array.isArray(res.body.users)).toBe(true);
		expect(res.body.total).toBe(1);
		expect(res.body.page).toBe(1);
		expect(res.body.page_size).toBe(50);
		expect(res.body.total_pages).toBe(1);
		expect(res.body.users[0]).toMatchObject({
			user_id: "default_user_id",
			user_email: "admin@example.com",
			user_role: "proxy_admin",
			spend: 12.5,
			models: [],
			metadata: {},
		});
		expect(res.body.users[0].key_count).toBeUndefined();
	});

	it("空用户列表也应返回稳定分页 shape", async () => {
		const app = makeApp([]);

		const res = await request(app).get("/user/list?page=2&page_size=10");

		expect(res.status).toBe(200);
		expect(res.body.users).toEqual([]);
		expect(res.body.total).toBe(0);
		expect(res.body.page).toBe(2);
		expect(res.body.page_size).toBe(10);
		expect(res.body.total_pages).toBe(1);
	});

	it("应支持 WebUI 传入的过滤参数且不破坏 shape", async () => {
		const app = makeApp([
			makeUser({ userId: "u1", userEmail: "alice@example.com", userRole: "internal_user", teamId: "team-a" }),
			makeUser({ userId: "u2", userEmail: "bob@example.com", userRole: "proxy_admin", teamId: "team-b" }),
		]);

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
		const app = makeApp([
			makeUser({ userId: "u1", spend: 3, userEmail: "c@example.com" }),
			makeUser({ userId: "u2", spend: 1, userEmail: "b@example.com" }),
			makeUser({ userId: "u3", spend: 2, userEmail: "a@example.com" }),
		]);

		const res = await request(app).get("/user/list?page=2&page_size=2&sort_by=spend&sort_order=asc");

		expect(res.status).toBe(200);
		expect(res.body.users.map((user: { user_id: string }) => user.user_id)).toEqual(["u1"]);
		expect(res.body.total).toBe(3);
		expect(res.body.page).toBe(2);
		expect(res.body.page_size).toBe(2);
		expect(res.body.total_pages).toBe(2);
	});

	it("非法 sort_by 应回退 user_id，非法 page_size 应回退默认值", async () => {
		const app = makeApp([makeUser({ userId: "b" }), makeUser({ userId: "a" })]);

		const res = await request(app).get("/user/list?page=1&page_size=0&sort_by=unknown&sort_order=desc");

		expect(res.status).toBe(200);
		expect(res.body.page_size).toBe(50);
		expect(res.body.users.map((user: { user_id: string }) => user.user_id)).toEqual(["b", "a"]);
	});

	it("user_email 过滤应大小写不敏感，越界页应返回空 users 但保留 total", async () => {
		const app = makeApp([makeUser({ userId: "u1", userEmail: "Alice@Example.com" })]);

		const res = await request(app).get("/user/list?page=99&page_size=10&user_email=alice");

		expect(res.status).toBe(200);
		expect(res.body.users).toEqual([]);
		expect(res.body.total).toBe(1);
		expect(res.body.total_pages).toBe(1);
	});
});
