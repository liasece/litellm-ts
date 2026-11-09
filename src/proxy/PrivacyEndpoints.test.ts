/**
 * 脱敏设置端点契约：读取回退默认值、写入保留其它键、非法输入 400。
 */
import express from "express";
import request from "supertest";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { registerPrivacyRoutes } from "./PrivacyEndpoints";

interface MockDb {
	readonly db: unknown;
	readonly stored: () => Record<string, unknown> | null;
}

/**
 * 只实现 LiteLLM_Config 单行读写的 mock db。
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
 * @param mockDb - 注入的 mock db
 */
function makeApp(mockDb: MockDb): express.Express {
	void dbConfigProvider.initialize(mockDb.db as never);
	const app = express();
	app.use(express.json());
	const router = express.Router();
	registerPrivacyRoutes(router, mockDb.db as never);
	app.use(router);
	return app;
}

describe("privacy settings endpoints", () => {
	it("未配置时返回默认值（开启 + mask）", async () => {
		const mockDb = makeDb({ store_model_in_db: true });
		const response = await request(makeApp(mockDb)).get("/privacy/settings").expect(200);
		const body = response.body as { values: { enabled: boolean; action: string }; defaults: { enabled: boolean } };
		expect(body.values.enabled).toBe(true);
		expect(body.values.action).toBe("mask");
		expect(body.defaults.enabled).toBe(true);
	});

	it("写入只改 privacy_masking，其它键保持", async () => {
		const mockDb = makeDb({ store_model_in_db: true, privacy_masking: { enabled: true } });
		const response = await request(makeApp(mockDb))
			.put("/privacy/settings")
			.send({ enabled: false, kinds: { EMAIL: "off" }, custom_words: ["蓝鲸计划"] })
			.expect(200);
		const body = response.body as { values: { enabled: boolean; kinds: Record<string, string>; custom_words: unknown[] } };
		expect(body.values.enabled).toBe(false);
		expect(body.values.kinds["EMAIL"]).toBe("off");
		expect(body.values.custom_words).toHaveLength(1);
		const stored = mockDb.stored();
		expect(stored?.["store_model_in_db"]).toBe(true);
		expect((stored?.["privacy_masking"] as Record<string, unknown>)["enabled"]).toBe(false);
	});

	it("非法类型或动作返回 400", async () => {
		const mockDb = makeDb({});
		const app = makeApp(mockDb);
		await request(app).put("/privacy/settings").send({ kinds: { NOT_A_KIND: "off" } }).expect(400);
		await request(app).put("/privacy/settings").send({ action: "block" }).expect(400);
		await request(app).put("/privacy/settings").send({ enabled: "yes" }).expect(400);
	});
});
