import { dbConfigProvider } from "./DbConfigProvider";
import { runtimeConfigCacheFor } from "../../repositories/RuntimeConfigCache";

type ConfigRow = { param_name: string; param_value: unknown };

function createDb(state: ConfigRow[]): { db: never; calls: { config: number } } {
	const calls = { config: 0 };
	const db = {
		select: () => ({
			from: () => {
				calls.config += 1;
				return Promise.resolve(state.map((row) => ({ ...row })));
			},
		}),
	};
	return { db: db as never, calls };
}

describe("DbConfigProvider", () => {
	it("读取复用 repo 层副本，副本失效后重新装载", async () => {
		const state: ConfigRow[] = [
			{ param_name: "general_settings", param_value: { store_prompts_in_spend_logs: false } },
		];
		const { db, calls } = createDb(state);
		await dbConfigProvider.initialize(db);

		expect(await dbConfigProvider.getParam("general_settings")).toEqual({ store_prompts_in_spend_logs: false });
		expect(await dbConfigProvider.getParam("general_settings")).toEqual({ store_prompts_in_spend_logs: false });
		expect(calls.config).toBe(1);

		state[0] = { param_name: "general_settings", param_value: { store_prompts_in_spend_logs: true } };
		runtimeConfigCacheFor(db).invalidateConfig();

		expect(await dbConfigProvider.getParam("general_settings")).toEqual({ store_prompts_in_spend_logs: true });
		expect(calls.config).toBe(2);
	});

	it("YAML 默认值与 DB 覆盖合并，包括显式 false 与 0", async () => {
		const defaults = { keepalive_seconds: 10, enabled: true };
		dbConfigProvider.setDefaults({ litellm_settings: defaults });
		defaults.keepalive_seconds = 99;

		const state: ConfigRow[] = [{ param_name: "litellm_settings", param_value: { enabled: false, keepalive_seconds: 0 } }];
		const { db } = createDb(state);
		await dbConfigProvider.initialize(db);

		expect(await dbConfigProvider.getEffectiveParam("litellm_settings")).toEqual({ enabled: false, keepalive_seconds: 0 });

		state[0] = { param_name: "litellm_settings", param_value: {} };
		runtimeConfigCacheFor(db).invalidateConfig();
		expect(await dbConfigProvider.getEffectiveParam("litellm_settings")).toEqual({ enabled: true, keepalive_seconds: 10 });
		dbConfigProvider.setDefaults({});
	});
});
