/**
 * 服务容器测试
 *
 * 覆盖：
 * - router_settings.enable_pre_call_checks / max_fallbacks 传入 RouterConfig
 *   （PY router_settings → Router 构造参数对齐；未接入时 no-deployments 消息
 *   pre-call-checks=False 与 PY 实测不符）
 * - config 生成的 deployment sha256 id 流入 Router deployments
 * - 批次 C2：启动时 DB router_settings 覆盖 yaml（Python _update_dictionary DB 优先语义）
 * - 批次 C2：DB 模型回灌（LiteLLM_ProxyModelTable 与 yaml modelList 合并，同 model_id DB 优先）
 */
import { createServiceContainer } from "./container";
import { validateAndTransform } from "./core/config";
import { modelCostMapService } from "./cost/ModelCostMapService";

/** 测试可控的 DB 配置参数（dbConfigProvider mock 数据源），每个用例前重置 */
const mockConfigParams: Record<string, Record<string, unknown>> = {};
/** 测试可控的 LiteLLM_ProxyModelTable 行（Database mock 数据源），每个用例前重置 */
const mockDbModelRows: Array<Record<string, unknown>> = [];
/** 测试可控的 LiteLLM_CredentialsTable 行（Database mock 数据源），每个用例前重置 */
const mockCredentialRows: Array<Record<string, unknown>> = [];

jest.mock("./cost/ModelCostMapService", () => ({
	modelCostMapService: {
		initialize: jest.fn().mockResolvedValue(undefined),
		getSnapshot: jest.fn(() => ({ map: {} })),
	},
}));

jest.mock("./core/config/DbConfigProvider", () => ({
	dbConfigProvider: {
		initialize: jest.fn().mockResolvedValue(undefined),
		getParam: jest.fn((paramName: string) => mockConfigParams[paramName] ?? {}),
		hasParam: jest.fn((paramName: string, key: string) => key in (mockConfigParams[paramName] ?? {})),
		refreshNow: jest.fn().mockResolvedValue(undefined),
	},
}));

// Database 初始化依赖真实 PostgreSQL，容器装配测试使用可控的请求级 DB 快照。
jest.mock("./core/db/Database", () => ({
	Database: jest.fn().mockImplementation(() => {
		const db: {
			select: jest.Mock;
			transaction: jest.Mock;
		} = {
			select: jest.fn(() => ({
				from: jest.fn((table: Record<string, unknown>) => {
					if ("credential_name" in table) {
						return Promise.resolve(mockCredentialRows);
					}
					if ("param_name" in table) {
						return Promise.resolve(
							Object.entries(mockConfigParams).map(([param_name, param_value]) => ({ param_name, param_value })),
						);
					}
					return Promise.resolve(mockDbModelRows);
				}),
			})),
			transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => await callback(db)),
		};
		return {
			initialize: jest.fn().mockResolvedValue(undefined),
			db: db,
		};
	}),
}));

beforeEach(() => {
	for (const key of Object.keys(mockConfigParams)) {
		delete mockConfigParams[key];
	}
	mockDbModelRows.length = 0;
	mockCredentialRows.length = 0;
});

async function withDatabaseSnapshot<T>(
	container: Awaited<ReturnType<typeof createServiceContainer>>,
	callback: () => T,
): Promise<T> {
	const snapshot = await container.runtimeConfigService.loadSnapshot(container.router);
	return container.router.runWithRuntimeSnapshot(snapshot, callback);
}

describe("createServiceContainer — router_settings 接线", () => {
	it("enable_pre_call_checks / max_fallbacks 传入 Router", async () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
			router_settings: { enable_pre_call_checks: true, max_fallbacks: 10 },
		});
		const container = await createServiceContainer(config);
		expect(modelCostMapService.initialize).toHaveBeenCalled();
		expect(container.modelCostMapService).toBe(modelCostMapService);
		await withDatabaseSnapshot(container, () => {
			expect(container.router.getNoAvailableDeploymentInfo("missing").preCallChecks).toBe(true);
			expect(container.router.maxFallbacks).toBe(10);
		});
	});

	it("缺省时走 Router 默认（preCallChecks=false / maxFallbacks=5）", async () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
		});
		const container = await createServiceContainer(config);
		await withDatabaseSnapshot(container, () => {
			expect(container.router.getNoAvailableDeploymentInfo("missing").preCallChecks).toBe(false);
			expect(container.router.maxFallbacks).toBe(5);
		});
	});

	it("DB 中的模型通过 ProxyModelDeployment 流入 Router deployments", async () => {
		const config = validateAndTransform({
			model_list: [
				{
					model_name: "glm-4-7-anthropic",
					litellm_params: {
						model: "anthropic/glm-4.7",
						api_base: "https://open.bigmodel.cn/api/anthropic",
						api_key: "34365d9a2acc4ffc90a944b986bd2418.qFCAYvl1GnOmUXo3",
					},
				},
			],
		});
		// 运行时模型只从 DB 加载，需要预先插入 mock DB 行
		mockDbModelRows.push({
			model_id: "test-glm-id",
			model_name: "glm-4-7-anthropic",
			litellm_params: {
				model: "anthropic/glm-4.7",
				api_base: "https://open.bigmodel.cn/api/anthropic",
				api_key: "sk-test",
			},
			model_info: {},
		});
		const container = await createServiceContainer(config);
		await withDatabaseSnapshot(container, () => {
			const deployments = container.router.getDeployments();
			expect(deployments).toHaveLength(1);
			expect(deployments[0]?.model_info?.id).toBe("test-glm-id");
		});
	});
});

describe("createServiceContainer — Credential 接线", () => {
	it("Credential 管理读取直接来自持久层，不暴露进程级明文 accessor", async () => {
		mockCredentialRows.push({
			credential_id: "credential-1",
			credential_name: "openai-prod",
			credential_values: { api_key: "sk-secret" },
			credential_info: { custom_llm_provider: "openai" },
			created_at: new Date(),
			created_by: "user-a",
			updated_at: new Date(),
			updated_by: "user-a",
		});
		const config = validateAndTransform({});

		const container = await createServiceContainer(config);

		expect(await container.credentialService.list()).toEqual([
			expect.objectContaining({
				credential_name: "openai-prod",
				credential_values: { api_key: "********" },
			}),
		]);
	});
});

describe("createServiceContainer — 批次 C2 启动合并", () => {
	it("DB router_settings 覆盖 yaml（num_retries 覆盖 + fallbacks 新增后 getNextFallback 走 DB 链）", async () => {
		mockConfigParams["router_settings"] = { num_retries: 7, fallbacks: [{ "gpt-5": ["gpt-5-mini"] }] };
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
			router_settings: { num_retries: 2 },
		});
		const container = await createServiceContainer(config);
		const snapshot = await container.runtimeConfigService.loadSnapshot(container.router);
		expect(snapshot.numRetries).toBe(7);
		container.router.runWithRuntimeSnapshot(snapshot, () => {
			expect(container.router.getNextFallback("gpt-5", 0)).toBe("gpt-5-mini");
		});
	});

	it("DB 无 router_settings 时 yaml 值保持生效", async () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
			router_settings: { num_retries: 4 },
		});
		const container = await createServiceContainer(config);
		const snapshot = await container.runtimeConfigService.loadSnapshot(container.router);
		expect(snapshot.numRetries).toBe(4);
	});

	it("DB router_settings 含非法 routing_strategy 时请求快照 fail closed", async () => {
		mockConfigParams["router_settings"] = { routing_strategy: "not-a-strategy", num_retries: 9 };
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
			router_settings: { num_retries: 2 },
		});
		const container = await createServiceContainer(config);
		await expect(container.runtimeConfigService.loadSnapshot(container.router)).rejects.toThrow("Unknown routing strategy");
	});

	it("DB 模型回灌：DB 独有模型加入 Router 且 model_info.db_model=true，可立即路由", async () => {
		mockDbModelRows.push({
			model_id: "db-model-1",
			model_name: "db-only-model",
			litellm_params: { model: "openai/gpt-4o", api_key: "sk-db" },
			model_info: {},
		});
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
		});
		const container = await createServiceContainer(config);
		await withDatabaseSnapshot(container, () => {
			expect(container.router.hasModel("db-only-model")).toBe(true);
			const dbDeployment = container.router.getDeployment("db-model-1");
			expect(dbDeployment?.model_info?.id).toBe("db-model-1");
			expect((dbDeployment?.model_info as Record<string, unknown> | undefined)?.["db_model"]).toBe(true);
		});
	});

	it("DB 模型回灌：模型仅从 DB 加载，DB 值为准", async () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-yaml" } }],
		});
		// 运行时模型仅从 DB 加载，yaml model_list 不影响 Router
		mockDbModelRows.push({
			model_id: "db-gpt-5-id",
			model_name: "gpt-5",
			litellm_params: { model: "openai/gpt-5", api_key: "sk-db-override" },
			model_info: {},
		});
		const container = await createServiceContainer(config);
		await withDatabaseSnapshot(container, () => {
			const deployments = container.router.getDeployments();
			expect(deployments).toHaveLength(1);
			expect(deployments[0]?.litellm_params["api_key"]).toBe("sk-db-override");
		});
	});
});
