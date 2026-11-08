/**
 * 费用折扣 / 保证金 / 估算端点的契约测试。
 *
 * 锁定 Dashboard Cost Tracking 页依赖的行为：
 * - GET 返回 { values }，PATCH 校验并持久化到 litellm_settings（保留同段其它键）；
 * - 非法 provider / 比例返回 400，错误信息说明本部署可用项；
 * - /cost/estimate 用与 /model_group/info 相同的 deployment 价格计算，并按当前保证金配置加价；
 * - 未知模型不返回 200/0 假成功。
 */
import express from "express";
import request from "supertest";
import { costTrackingConfigService } from "../cost/CostTrackingConfig";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { Deployment } from "../types/router";
import { registerCostTrackingRoutes } from "./CostTrackingEndpoints";

interface MockDb {
	readonly db: unknown;
	readonly stored: () => Record<string, unknown> | null;
}

/**
 * 只实现 LiteLLM_Config 单行读写的 mock db。
 * 查询链同时支持 `await db.select().from(...)`（ConfigRepository）和
 * `.where().limit()`（DbConfigProvider）。
 * @param initial - 初始 litellm_settings
 */
function makeDb(initial: Record<string, unknown> | null): MockDb {
	let stored = initial === null ? null : { ...initial };
	const rows = () => (stored === null ? [] : [{ param_name: "litellm_settings", param_value: stored }]);
	const query = (): Record<string, unknown> => {
		const resolved = Promise.resolve(rows());
		const chain: Record<string, unknown> = {
			where: () => chain,
			limit: () => resolved,
			then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => resolved.then(resolve, reject),
		};
		return chain;
	};
	const db = {
		select: () => ({ from: () => query() }),
		insert: () => ({
			values: () => ({
				onConflictDoUpdate: (config: { set: { param_value: Record<string, unknown> } }) => {
					stored = config.set.param_value;
					return Promise.resolve();
				},
			}),
		}),
	};
	return { db: db, stored: () => stored };
}

/**
 * 与生产一致的 deployment 价格来源：model_info 上的 per-token 价格。
 */
function makeDeployments(): Deployment[] {
	return [
		{
			model_name: "glm-5.2",
			litellm_params: { model: "cliproxy/glm-5.2", custom_llm_provider: "cliproxy" },
			model_info: { id: "dep-glm", input_cost_per_token: 0.001, output_cost_per_token: 0.002 },
		} as unknown as Deployment,
	];
}

/**
 * @param mockDb - 注入的 mock db
 */
function makeApp(mockDb: MockDb, role = "proxy_admin"): express.Express {
	// GET 端点在运行时读 dbConfigProvider（DB 覆盖 + yaml 默认），测试注入同一个 mock db
	void dbConfigProvider.initialize(mockDb.db as never);
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_id: "user-1", user_role: role } as never;
		next();
	});
	const router = express.Router();
	registerCostTrackingRoutes(router, mockDb.db as never, { getDeployments: () => makeDeployments() });
	app.use(router);
	return app;
}

afterEach(() => {
	costTrackingConfigService.reset();
});

describe("cost discount config endpoint", () => {
	it("returns stored values and persists patches without dropping other litellm_settings", async () => {
		const mockDb = makeDb({ cache: true });
		const app = makeApp(mockDb);

		await request(app).get("/config/cost_discount_config").expect(200, { values: {} });

		const patched = await request(app).patch("/config/cost_discount_config").send({ cliproxy: 0.25 }).expect(200);
		expect(patched.body).toEqual({ values: { cliproxy: 0.25 } });
		expect(mockDb.stored()).toEqual({ cache: true, cost_discount_config: { cliproxy: 0.25 } });

		await request(app).get("/config/cost_discount_config").expect(200, { values: { cliproxy: 0.25 } });
	});

	it("rejects invalid provider and range with a 400 that names the problem", async () => {
		const mockDb = makeDb(null);
		const app = makeApp(mockDb);

		const invalidProvider = await request(app).patch("/config/cost_discount_config").send({ groq: 0.1 }).expect(400);
		expect(JSON.stringify(invalidProvider.body)).toContain("Invalid provider(s): groq");
		await request(app).patch("/config/cost_discount_config").send({ cliproxy: 1.5 }).expect(400);
		expect(mockDb.stored()).toBeNull();
	});
});

describe("cost margin config endpoint", () => {
	it("accepts percentage objects with fixed amounts and returns them on GET", async () => {
		const mockDb = makeDb(null);
		const app = makeApp(mockDb);

		await request(app)
			.patch("/config/cost_margin_config")
			.send({ cliproxy: { percentage: 0.1, fixed_amount: 0.000001 }, global: 0.05 })
			.expect(200);

		const response = await request(app).get("/config/cost_margin_config").expect(200);
		expect(response.body).toEqual({ values: { cliproxy: { fixed_amount: 0.000001, percentage: 0.1 }, global: 0.05 } });
	});

	it("lets any authenticated reader read but only proxy_admin write real billing amounts", async () => {
		const mockDb = makeDb(null);
		const app = makeApp(mockDb, "internal_user");
		// 读取沿用 PY 的任意已认证 Key 语义，页面上的定价计算器对非管理员也可用
		await request(app).get("/config/cost_margin_config").expect(200);
		await request(app).get("/config/cost_discount_config").expect(200);
		await request(app).patch("/config/cost_margin_config").send({ global: 0.1 }).expect(403);
		await request(app).patch("/config/cost_discount_config").send({ cliproxy: 0.1 }).expect(403);
		expect(mockDb.stored()).toBeNull();
	});

	it("rejects negative fixed amounts so billed amounts cannot silently shrink", async () => {
		const mockDb = makeDb(null);
		await request(makeApp(mockDb)).patch("/config/cost_margin_config").send({ cliproxy: { fixed_amount: -0.01 } }).expect(400);
		expect(mockDb.stored()).toBeNull();
	});
});

describe("cost estimate endpoint", () => {
	it("prices tokens like /model_group/info and applies the configured margin", async () => {
		const app = makeApp(makeDb(null));
		costTrackingConfigService.setValues({}, { cliproxy: 0.1 });

		const response = await request(app)
			.post("/cost/estimate")
			.send({ model: "glm-5.2", input_tokens: 100, output_tokens: 50, num_requests_per_day: 10 })
			.expect(200);
		const body = response.body as Record<string, number | string | null>;

		expect(body["input_cost_per_request"]).toBeCloseTo(0.1, 10);
		expect(body["output_cost_per_request"]).toBeCloseTo(0.1, 10);
		expect(body["margin_cost_per_request"]).toBeCloseTo(0.02, 10);
		expect(body["cost_per_request"]).toBeCloseTo(0.22, 10);
		expect(body["daily_cost"]).toBeCloseTo(2.2, 10);
		expect(body["monthly_cost"]).toBeNull();
		expect(body["provider"]).toBe("cliproxy");
	});

	it("applies discounts before margins and reports per-token prices", async () => {
		const app = makeApp(makeDb(null));
		costTrackingConfigService.setValues({ cliproxy: 0.5 }, { global: 0.1 });

		const response = await request(app)
			.post("/cost/estimate")
			.send({ model: "glm-5.2", input_tokens: 100, output_tokens: 50 })
			.expect(200);
		const body = response.body as Record<string, number | null>;

		// 基础 0.2 → 折扣 50% = 0.1 → global 保证金 10% = 0.11
		expect(body["cost_per_request"]).toBeCloseTo(0.11, 10);
		expect(body["input_cost_per_token"]).toBeCloseTo(0.001, 12);
		expect(body["output_cost_per_token"]).toBeCloseTo(0.002, 12);
	});

	it("fails loudly for unknown models and missing tokens instead of returning a fake zero", async () => {
		const app = makeApp(makeDb(null));
		await request(app).post("/cost/estimate").send({ model: "does-not-exist", input_tokens: 1, output_tokens: 1 }).expect(404);
		await request(app).post("/cost/estimate").send({ input_tokens: 1, output_tokens: 1 }).expect(400);
	});
});
