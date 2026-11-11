import { validateAndTransform } from "./index";
import { DatabaseRuntimeConfigService } from "./DatabaseRuntimeConfigService";
import { Router } from "../../router/Router";
import { RoutingStrategyName } from "../../types/router";
import { ConfigRepository } from "../../repositories/ConfigRepository";
import { configRepositoryFor } from "../../repositories/ConfigRepository";
import { modelRepositoryFor } from "../../repositories/ModelRepository";
import { credentialRepositoryFor } from "../../repositories/CredentialRepository";

interface TableState {
	config: Array<{ param_name: string; param_value: Record<string, unknown> }>;
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
		insert: () => ({
			values: () => ({
				onConflictDoUpdate: () => Promise.resolve(undefined),
			}),
		}),
	};
	return { db: db as never, calls };
}

function createState(): TableState {
	return {
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
}

function createRouter(): Router {
	return new Router({
		model_list: [],
		routing_strategy: RoutingStrategyName.LatencyBasedRouting,
		num_retries: 2,
	});
}

describe("DatabaseRuntimeConfigService", () => {
	it("同一数据库连接的多次快照共享副本，且旧请求快照保持隔离", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const router = createRouter();
		const service = new DatabaseRuntimeConfigService(db, validateAndTransform({}));

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
			configRepositoryFor(db).invalidateCache();
			modelRepositoryFor(db).invalidateCache();
			credentialRepositoryFor(db).invalidateCache();

			const second = await service.loadSnapshot(router);
			router.runWithRuntimeSnapshot(second, () => {
				expect(router.getAvailableDeployment("alias_old")).toBeNull();
				expect(router.getAvailableDeployment("alias_new")?.deployment.model_name).toBe("group-new");
			});

			// 外层仍是第一次请求的不可变快照，不受第二次装载覆盖。
			expect(router.getAvailableDeployment("alias_old")?.deployment.model_name).toBe("group-old");
			expect(router.getAvailableDeployment("alias_new")).toBeNull();
		});

		// 两次装载之间没有失效，第二张快照直接复用副本。
		const third = await service.loadSnapshot(router);
		router.runWithRuntimeSnapshot(third, () => {
			expect(router.getAvailableDeployment("alias_new")?.deployment.model_name).toBe("group-new");
		});
		expect(calls.config).toBe(2);
		expect(calls.models).toBe(2);
		expect(calls.credentials).toBe(2);
	});

	it("配置仓库写入后下一个快照立即生效，且不重新查询配置表", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const router = createRouter();
		const service = new DatabaseRuntimeConfigService(db, validateAndTransform({}));

		await service.loadSnapshot(router);
		expect(calls.config).toBe(1);

		state.models = [
			{
				model_id: "deployment-1",
				model_name: "group-new",
				litellm_params: { model: "openai/gpt-4o" },
				model_info: {},
			},
		];
		modelRepositoryFor(db).invalidateCache();
		await new ConfigRepository(db).upsertParam("router_settings", {
			model_group_alias: { alias_new: "group-new" },
			routing_strategy: "simple-shuffle",
		});

		const snapshot = await service.loadSnapshot(router);
		router.runWithRuntimeSnapshot(snapshot, () => {
			expect(router.getAvailableDeployment("alias_old")).toBeNull();
			expect(router.getAvailableDeployment("alias_new")?.deployment.model_name).toBe("group-new");
		});
		expect(calls.config).toBe(1);
		expect(calls.models).toBe(2);
	});

	it("凭据仓库失效后下一个快照读到新密钥", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const router = createRouter();
		const service = new DatabaseRuntimeConfigService(db, validateAndTransform({}));

		await service.loadSnapshot(router);
		state.credentials = [
			{
				credential_name: "credential-1",
				credential_values: { api_key: "new-key" },
				credential_info: { custom_llm_provider: "openai" },
			},
		];
		credentialRepositoryFor(db).invalidateCache();

		const snapshot = await service.loadSnapshot(router);
		await router.runWithRuntimeSnapshot(snapshot, async () => {
			const candidate = router.getAvailableDeployment("alias_old");
			expect(candidate?.deployment.litellm_params["api_key"]).toBe("new-key");
		});
		expect(calls.credentials).toBe(2);
	});

	it("同一请求经过多条路由链时复用已绑定的快照", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const router = createRouter();
		const service = new DatabaseRuntimeConfigService(db, validateAndTransform({}));
		const middleware = service.middleware(router);

		await new Promise<void>((resolve, reject) => {
			middleware({} as never, {} as never, (firstError?: unknown) => {
				if (firstError !== undefined) {
					reject(firstError);
					return;
				}
				middleware({} as never, {} as never, (secondError?: unknown) => {
					if (secondError !== undefined) {
						reject(secondError);
						return;
					}
					resolve();
				});
			});
		});

		expect(calls.config).toBe(1);
		expect(calls.models).toBe(1);
		expect(calls.credentials).toBe(1);
	});

	it("runWithSnapshot 为 WebSocket 链路绑定同一份请求级快照", async () => {
		const state = createState();
		const { db, calls } = createDb(state);
		const router = createRouter();
		const service = new DatabaseRuntimeConfigService(db, validateAndTransform({}));

		const visible = await service.runWithSnapshot(router, () => {
			expect(router.getAvailableDeployment("group-old")?.deployment.model_name).toBe("group-old");
			return true;
		});
		expect(visible).toBe(true);

		await service.runWithSnapshot(router, () => undefined);
		expect(calls.config).toBe(1);
		expect(calls.models).toBe(1);
		expect(calls.credentials).toBe(1);
	});

	it("装载失败时 fail closed 返回 503", async () => {
		const db = {
			select: () => ({
				from: () => Promise.reject(new Error("db unavailable")),
			}),
		} as never;
		const router = createRouter();
		const service = new DatabaseRuntimeConfigService(db, validateAndTransform({}));
		const middleware = service.middleware(router);

		const error = await new Promise<unknown>((resolve, reject) => {
			middleware({} as never, {} as never, (received?: unknown) => {
				if (received === undefined) {
					reject(new Error("middleware should fail closed"));
					return;
				}
				resolve(received);
			});
		});
		expect((error as { statusCode?: number }).statusCode).toBe(503);
	});
});
