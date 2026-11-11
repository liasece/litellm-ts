/**
 * CustomerEndpoint /customer/list 契约测试
 *
 * 锁定 Python LiteLLM list_end_user 行为：返回裸数组（无 {success,data} 包装），
 * 字段 snake_case，litellm_budget_table / object_permission 为关联对象或 null。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/management_endpoints/customer_endpoints.py
 */
import express from "express";
import request from "supertest";
import { createCustomerRoutes } from "./CustomerEndpoint";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";
import { LiteLLM_ObjectPermissionTable } from "../db/schema/object-permissions";

interface MockTables {
	readonly endUsers: unknown[];
	readonly budgets?: unknown[];
	readonly objectPermissions?: unknown[];
}

/**
 * 按 drizzle table 对象路由到对应 mock 数据集。
 * @param tables
 * @param table
 */
function rowsForTable(tables: MockTables, table: unknown): unknown[] {
	if (table === LiteLLM_EndUserTable) {
		return tables.endUsers;
	}
	if (table === LiteLLM_BudgetTable) {
		return tables.budgets ?? [];
	}
	if (table === LiteLLM_ObjectPermissionTable) {
		return tables.objectPermissions ?? [];
	}
	return [];
}

/** 展开 drizzle SQL 里的字符串片段与绑定值，便于断言过滤条件落在数据库侧。 */
function describeSql(node: unknown): string {
	if (node === null || node === undefined) {
		return "";
	}
	if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
		return String(node);
	}
	if (typeof node === "object") {
		const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
		if (Array.isArray(chunks)) {
			return chunks.map(describeSql).join("");
		}
		const value = (node as { value?: unknown }).value;
		if (value !== undefined) {
			return describeSql(value);
		}
	}
	try {
		return JSON.stringify(node) ?? "";
	} catch {
		return "";
	}
}

/**
 * 可链式 select mock：记录 where SQL，按 limit 截断结果，使 `/customer/list`
 * 的「服务端搜索 + 截断」行为可以直接断言。
 */
function makeApp(tables: MockTables, recorded: { whereSql: string[]; limits: number[] } = { whereSql: [], limits: [] }): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const rows = rowsForTable(tables, table);
				let limit: number | null = null;
				const query = {
					where: (condition: unknown) => {
						recorded.whereSql.push(describeSql(condition));
						return query;
					},
					orderBy: () => query,
					limit: (value: number) => {
						limit = value;
						recorded.limits.push(value);
						return query;
					},
					then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
						Promise.resolve(limit === null ? rows : rows.slice(0, limit)).then(resolve, reject),
				};
				return query;
			},
		}),
	};
	createCustomerRoutes(router, db as never, null);
	app.use(router);
	return app;
}

function makeEndUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		userId: "user-1",
		alias: null,
		spend: 0.5,
		allowedModelRegion: null,
		defaultModel: null,
		budgetId: null,
		objectPermissionId: null,
		blocked: false,
		...overrides,
	};
}

describe("CustomerEndpoint /customer/list 契约", () => {
	it("返回裸数组且字段 snake_case（对齐 Python 实测）", async () => {
		const app = makeApp({ endUsers: [makeEndUser()] });

		const res = await request(app).get("/customer/list");

		expect(res.status).toBe(200);
		expect(Array.isArray(res.body)).toBe(true);
		expect(res.body.success).toBeUndefined();
		expect(res.body.data).toBeUndefined();
		expect(res.body[0]).toEqual({
			user_id: "user-1",
			blocked: false,
			alias: null,
			spend: 0.5,
			allowed_model_region: null,
			default_model: null,
			litellm_budget_table: null,
			object_permission_id: null,
			object_permission: null,
		});
	});

	it("关联 budget 与 object_permission 时返回 join 对象", async () => {
		const app = makeApp({
			endUsers: [makeEndUser({ budgetId: "budget-1", objectPermissionId: "perm-1" })],
			budgets: [{ budget_id: "budget-1", max_budget: 10, tpm_limit: null, rpm_limit: null }],
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
		});

		const res = await request(app).get("/customer/list");

		expect(res.status).toBe(200);
		expect(res.body[0].litellm_budget_table).toMatchObject({ budget_id: "budget-1", max_budget: 10 });
		expect(res.body[0].object_permission).toMatchObject({ object_permission_id: "perm-1", mcp_servers: ["srv-a"] });
		expect(res.body[0].object_permission_id).toBe("perm-1");
	});

	it("空表返回空数组", async () => {
		const app = makeApp({ endUsers: [] });

		const res = await request(app).get("/customer/list");

		expect(res.status).toBe(200);
		expect(res.body).toEqual([]);
	});

	it("search 在数据库侧过滤，不再整表下发", async () => {
		const recorded = { whereSql: [] as string[], limits: [] as number[] };
		const app = makeApp({ endUsers: [makeEndUser({ userId: "alice" })] }, recorded);

		const res = await request(app).get("/customer/list?search=ali");

		expect(res.status).toBe(200);
		expect(recorded.whereSql.join("\n")).toContain("ilike");
		expect(recorded.whereSql.join("\n")).toContain("ali");
	});

	it("size 截断候选数量，供表头过滤器只取一页", async () => {
		const recorded = { whereSql: [] as string[], limits: [] as number[] };
		const app = makeApp(
			{ endUsers: [makeEndUser({ userId: "user-1" }), makeEndUser({ userId: "user-2" }), makeEndUser({ userId: "user-3" })] },
			recorded,
		);

		const res = await request(app).get("/customer/list?size=2");

		expect(res.status).toBe(200);
		expect(recorded.limits).toContain(2);
		expect(res.body.map((row: { user_id: string }) => row.user_id)).toEqual(["user-1", "user-2"]);
	});
});

describe("CustomerEndpoint 写操作响应 Python 契约", () => {
	const CUSTOMER_WRITE_FIELDS = [
		"user_id",
		"alias",
		"spend",
		"allowed_model_region",
		"default_model",
		"budget_id",
		"object_permission_id",
		"litellm_budget_table",
		"object_permission",
		"blocked",
	];

	function makeCrudApp(endUsers: Record<string, unknown>[]): express.Express {
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const db = {
			select: () => ({
				from: () => ({
					where: () => {
						const promise = Promise.resolve(endUsers) as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
						promise.limit = (n: number) => Promise.resolve(endUsers.slice(0, n));
						return promise;
					},
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => ({
					returning: () =>
						Promise.resolve([
							{
								blocked: false,
								spend: 0,
								allowedModelRegion: null,
								defaultModel: null,
								budgetId: null,
								objectPermissionId: null,
								...values,
							},
						]),
				}),
			}),
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => ({
						returning: () => Promise.resolve([{ ...endUsers[0], ...values }]),
					}),
				}),
			}),
			delete: () => ({
				where: () => Promise.resolve({ rowCount: endUsers.length }),
			}),
		};
		createCustomerRoutes(router, db as never, null);
		app.use(router);
		return app;
	}

	it("/customer/new 返回 10 键端用户对象（无 success 包装）", async () => {
		const res = await request(makeCrudApp([])).post("/customer/new").send({ user_id: "cust-1", alias: "a" });

		expect(res.status).toBe(200);
		expect(res.body.success).toBeUndefined();
		expect(Object.keys(res.body).sort()).toEqual([...CUSTOMER_WRITE_FIELDS].sort());
		expect(res.body.user_id).toBe("cust-1");
		expect(res.body.alias).toBe("a");
		expect(res.body.litellm_budget_table).toBeNull();
	});

	it("/customer/update 返回更新后 10 键端用户对象", async () => {
		const app = makeCrudApp([
			{
				userId: "cust-1",
				alias: "a",
				allowedModelRegion: null,
				defaultModel: null,
				budgetId: null,
				objectPermissionId: null,
				blocked: false,
				spend: 0,
			},
		]);

		const res = await request(app).post("/customer/update").send({ user_id: "cust-1", alias: "b" });

		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual([...CUSTOMER_WRITE_FIELDS].sort());
		expect(res.body.alias).toBe("b");
	});

	it("/customer/delete 接受 user_ids 并返回 deleted_customers + Python 风格 message", async () => {
		const app = makeCrudApp([{ userId: "cust-1", budgetId: null }]);

		const res = await request(app)
			.post("/customer/delete")
			.send({ user_ids: ["cust-1"] });

		expect(res.status).toBe(200);
		expect(res.body.deleted_customers).toBe(1);
		expect(res.body.message).toBe("Successfully deleted customers with ids: ['cust-1']");
	});

	it("/customer/delete 缺 user_ids 返回 400；用户不存在返回 404", async () => {
		const app = makeCrudApp([]);

		const missing = await request(app).post("/customer/delete").send({});
		expect(missing.status).toBe(400);

		const notFound = await request(app)
			.post("/customer/delete")
			.send({ user_ids: ["ghost"] });
		expect(notFound.status).toBe(404);
		expect(notFound.body.error.message).toContain("do not exist in db");
	});
});
