import { runtimeConfigCacheFor, SAFETY_REFRESH_MS } from "./RuntimeConfigCache";

interface TableState {
	config: Array<Record<string, unknown>>;
	models: Array<Record<string, unknown>>;
	credentials: Array<Record<string, unknown>>;
}

function createDb(state: TableState): { db: never; calls: { config: number; models: number; credentials: number } } {
	const calls = { config: 0, models: 0, credentials: 0 };
	const db = {
		select: () => ({
			from: (table: Record<string, unknown>) => {
				if ("param_name" in table) {
					calls.config += 1;
					return Promise.resolve(state.config.map((row) => ({ ...row })));
				}
				if ("credential_name" in table) {
					calls.credentials += 1;
					return Promise.resolve(state.credentials.map((row) => ({ ...row })));
				}
				calls.models += 1;
				return Promise.resolve(state.models.map((row) => ({ ...row })));
			},
		}),
	};
	return { db: db as never, calls };
}

function createState(): TableState {
	return {
		config: [{ param_name: "router_settings", param_value: { routing_strategy: "simple-shuffle" } }],
		models: [{ model_id: "m1", model_name: "group-a", litellm_params: {}, model_info: {} }],
		credentials: [{ credential_name: "c1", credential_values: { api_key: "k1" }, credential_info: {} }],
	};
}

describe("RuntimeConfigCache", () => {
	it("并发读取同一张表只查询一次", async () => {
		const { db, calls } = createDb(createState());
		const cache = runtimeConfigCacheFor(db);
		const [first, second, third] = await Promise.all([cache.configRows(), cache.configRows(), cache.configRows()]);
		expect(calls.config).toBe(1);
		expect(first).toHaveLength(1);
		expect(second).toBe(first);
		expect(third).toBe(first);
	});

	it("配置参数写入后副本立即生效且不重新查询", async () => {
		const { db, calls } = createDb(createState());
		const cache = runtimeConfigCacheFor(db);
		await cache.configRows();
		cache.applyConfigParam("router_settings", { routing_strategy: "least-busy" });
		const rows = await cache.configRows();
		expect(calls.config).toBe(1);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.param_value).toEqual({ routing_strategy: "least-busy" });
	});

	it("模型与凭据写路径失效后各自重新装载一次", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const cache = runtimeConfigCacheFor(db);
		await Promise.all([cache.modelRows(), cache.credentialRows()]);
		expect(calls.models).toBe(1);
		expect(calls.credentials).toBe(1);

		state.models.push({ model_id: "m2", model_name: "group-b", litellm_params: {}, model_info: {} });
		cache.invalidateModels();
		expect(await cache.modelRows()).toHaveLength(2);
		expect(calls.models).toBe(2);

		state.credentials.push({ credential_name: "c2", credential_values: { api_key: "k2" }, credential_info: {} });
		cache.invalidateCredentials();
		expect(await cache.credentialRows()).toHaveLength(2);
		expect(calls.credentials).toBe(2);
		expect(calls.config).toBe(0);
	});

	it("超过安全刷新窗口后后台重载全部副本", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const cache = runtimeConfigCacheFor(db);
		await cache.configRows();
		expect(calls.config).toBe(1);

		const nowSpy = jest.spyOn(Date, "now").mockReturnValue(Date.now() + SAFETY_REFRESH_MS + 1);
		try {
			state.config = [{ param_name: "general_settings", param_value: { store_prompts_in_spend_logs: true } }];
			await cache.configRows();
			for (let tick = 0; tick < 20 && calls.config < 2; tick += 1) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		} finally {
			nowSpy.mockRestore();
		}

		expect(calls.config).toBe(2);
		const rows = await cache.configRows();
		expect(rows[0]?.param_name).toBe("general_settings");
	});

	it("冷启动装载失败时向上抛错（fail closed）", async () => {
		const db = {
			select: () => ({
				from: () => Promise.reject(new Error("db unavailable")),
			}),
		} as never;
		const cache = runtimeConfigCacheFor(db);
		await expect(cache.configRows()).rejects.toThrow("db unavailable");
	});
});
