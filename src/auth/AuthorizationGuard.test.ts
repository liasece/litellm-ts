import express from "express";
import request from "supertest";
import type { UserAPIKeyAuth } from "../types/auth";
import type { AuthRepository } from "./AuthRepository";
import { AuthorizationGuard } from "./AuthorizationGuard";

function makeAuth(overrides: Partial<UserAPIKeyAuth> = {}): UserAPIKeyAuth {
	return {
		api_key: "sk-caller",
		token: "caller-token",
		user_id: "user-a",
		user_role: "internal_user",
		...overrides,
	};
}

function makeRepository(team: Record<string, unknown> | null = null): AuthRepository {
	return {
		findTeamById: jest.fn().mockResolvedValue(team),
	} as unknown as AuthRepository;
}

function makeApp(guard: AuthorizationGuard, auth: UserAPIKeyAuth, capability: "inference" | "management") {
	const app = express();
	app.use((req, _res, next) => {
		req.auth = auth;
		next();
	});
	app.use(guard.middleware(capability));
	app.all("*", (req, res) => res.json({ path: req.path }));
	return app;
}

describe("AuthorizationGuard allowed_routes", () => {
	it("空 allowed_routes 不限制路由", async () => {
		const app = makeApp(new AuthorizationGuard(makeRepository()), makeAuth({ allowed_routes: [] }), "inference");
		expect((await request(app).post("/v1/chat/completions")).status).toBe(200);
	});

	it("支持 Python route-group、精确路径和 segment-safe wildcard", async () => {
		const guard = new AuthorizationGuard(makeRepository());
		const groupApp = makeApp(guard, makeAuth({ allowed_routes: ["llm_api_routes"] }), "inference");
		expect((await request(groupApp).post("/v1/chat/completions")).status).toBe(200);
		expect((await request(groupApp).post("/v1/messages/count_tokens?beta=true")).status).toBe(200);
		expect((await request(groupApp).post("/v1/messages/batches/batch_1/cancel")).status).toBe(200);
		expect((await request(groupApp).get("/v1/messages/batches/batch_1/results")).status).toBe(200);
		expect((await request(groupApp).get("/v1/files/file_1/content")).status).toBe(200);
		expect((await request(groupApp).get("/v1/responses/resp_1")).status).toBe(200);
		expect((await request(groupApp).post("/openai/deployments/gpt-4/chat/completions")).status).toBe(200);
		expect((await request(groupApp).get("/v1/models")).status).toBe(200);
		expect((await request(groupApp).post("/key/delete")).status).toBe(403);

		const wildcardApp = makeApp(guard, makeAuth({ allowed_routes: ["/key/*"] }), "inference");
		expect((await request(wildcardApp).get("/key/info")).status).toBe(200);
		expect((await request(wildcardApp).get("/key/info/details")).status).toBe(403);
		expect((await request(wildcardApp).get("/keyhole/info")).status).toBe(403);
	});
});

describe("AuthorizationGuard role 与对象权限", () => {
	it("management 写操作默认拒绝普通 key 与 viewer，proxy_admin 放行", async () => {
		const guard = new AuthorizationGuard(makeRepository());
		expect((await request(makeApp(guard, makeAuth(), "management")).post("/team/new")).status).toBe(403);
		expect((await request(makeApp(guard, makeAuth({ user_role: "proxy_admin_viewer" }), "management")).post("/team/new")).status).toBe(
			403,
		);
		expect((await request(makeApp(guard, makeAuth({ user_role: "proxy_admin" }), "management")).post("/team/new")).status).toBe(200);
	});

	it("key owner 可写自己的 key，不能写其他用户 key", async () => {
		const guard = new AuthorizationGuard(makeRepository());
		await expect(
			guard.assertKeyAccess(makeAuth(), [{ token: "owned", userId: "user-a", teamId: null }], "write"),
		).resolves.toBeUndefined();
		await expect(
			guard.assertKeyAccess(makeAuth(), [{ token: "other", userId: "user-b", teamId: null }], "write"),
		).rejects.toMatchObject({ statusCode: 403 });
	});

	it("team admin 可写团队 key，member 只能读", async () => {
		const guard = new AuthorizationGuard(
			makeRepository({ admins: ["admin-a"], members: ["admin-a", "member-a"], membersWithRoles: {} }),
		);
		const row = { token: "team-key", userId: "user-b", teamId: "team-a" };
		await expect(guard.assertKeyAccess(makeAuth({ user_id: "admin-a" }), [row], "write")).resolves.toBeUndefined();
		await expect(guard.assertKeyAccess(makeAuth({ user_id: "member-a" }), [row], "read")).resolves.toBeUndefined();
		await expect(guard.assertKeyAccess(makeAuth({ user_id: "member-a" }), [row], "write")).rejects.toMatchObject({ statusCode: 403 });
	});
});

describe("key field permission delegation", () => {
	it("limits permission edits to proxy admins", async () => {
		const guard = new AuthorizationGuard(makeRepository());
		await expect(guard.assertKeyFieldUpdates(makeAuth(), { permissions: { admin: true } })).rejects.toThrow("Only proxy admins");
		await expect(
			guard.assertKeyFieldUpdates(makeAuth({ user_role: "proxy_admin" }), { permissions: { admin: true } }),
		).resolves.toBeUndefined();
		await expect(guard.assertKeyFieldUpdates(makeAuth(), { key_alias: "safe-alias" })).resolves.toBeUndefined();
	});
});

it("permits organization PATCH only through the management route group, not key-only authorization", () => {
	const guard = new AuthorizationGuard({} as never);
	const next = jest.fn();
	const req = {
		path: "/v2/organization/org-1",
		method: "PATCH",
		auth: { api_key: "test", user_role: "proxy_admin", allowed_routes: ["key_management_routes"] },
	};
	guard.middleware("management")(req as never, {} as never, next);
	expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	next.mockClear();
	req.auth.allowed_routes = ["management_routes"];
	guard.middleware("management")(req as never, {} as never, next);
	expect(next).toHaveBeenCalledWith();
});
