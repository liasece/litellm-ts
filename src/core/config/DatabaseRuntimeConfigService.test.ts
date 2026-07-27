import { validateAndTransform } from "./index";
import { DatabaseRuntimeConfigService } from "./DatabaseRuntimeConfigService";
import { Router } from "../../router/Router";
import { RoutingStrategyName } from "../../types/router";

describe("DatabaseRuntimeConfigService", () => {
	it("每次请求重新读取模型、alias 与凭据，且旧请求快照保持隔离", async () => {
		const state: {
			config: Array<{ param_name: string; param_value: Record<string, unknown> }>;
			models: Array<Record<string, unknown>>;
			credentials: Array<Record<string, unknown>>;
		} = {
			config: [
				{
					param_name: "router_settings",
					param_value: { model_group_alias: { alias_old: "group-old" }, routing_strategy: "simple-shuffle" },
				},
			],
			models: [
				{
					model_id: "deployment-1",
					model_name: "group-old",
					litellm_params: { model: "openai/gpt-4o", litellm_credential_name: "credential-1" },
					model_info: {},
				},
			],
			credentials: [
				{
					credential_name: "credential-1",
					credential_values: { api_key: "old-key" },
					credential_info: { custom_llm_provider: "openai" },
				},
			],
		};
		const tx = {
			select: jest.fn(() => ({
				from: jest.fn((table: Record<string, unknown>) => {
					if ("param_name" in table) {
						return Promise.resolve(state.config);
					}
					if ("credential_name" in table) {
						return Promise.resolve(state.credentials);
					}
					return Promise.resolve(state.models);
				}),
			})),
		};
		const db = {
			transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => await callback(tx)),
		};
		const router = new Router({
			model_list: [],
			routing_strategy: RoutingStrategyName.LatencyBasedRouting,
			num_retries: 2,
		});
		const service = new DatabaseRuntimeConfigService(db as never, validateAndTransform({}));

		const first = await service.loadSnapshot(router);
		await router.runWithRuntimeSnapshot(first, async () => {
			await Promise.resolve();
			const candidate = router.getAvailableDeployment("alias_old");
			expect(candidate?.deployment.model_name).toBe("group-old");
			expect(candidate?.deployment.litellm_params["api_key"]).toBe("old-key");

			state.config = [
				{
					param_name: "router_settings",
					param_value: { model_group_alias: { alias_new: "group-new" }, routing_strategy: "simple-shuffle" },
				},
			];
			state.models = [
				{
					model_id: "deployment-1",
					model_name: "group-new",
					litellm_params: { model: "openai/gpt-4o", litellm_credential_name: "credential-1" },
					model_info: {},
				},
			];
			state.credentials = [
				{
					credential_name: "credential-1",
					credential_values: { api_key: "new-key" },
					credential_info: { custom_llm_provider: "openai" },
				},
			];

			const second = await service.loadSnapshot(router);
			router.runWithRuntimeSnapshot(second, () => {
				expect(router.getAvailableDeployment("alias_old")).toBeNull();
				const candidate = router.getAvailableDeployment("alias_new");
				expect(candidate?.deployment.model_name).toBe("group-new");
				expect(candidate?.deployment.litellm_params["api_key"]).toBe("new-key");
			});

			// 外层仍是第一次请求的不可变快照，不受第二次查询覆盖。
			expect(router.getAvailableDeployment("alias_old")?.deployment.litellm_params["api_key"]).toBe("old-key");
			expect(router.getAvailableDeployment("alias_new")).toBeNull();
		});
		expect(db.transaction).toHaveBeenCalledTimes(2);
	});
});
