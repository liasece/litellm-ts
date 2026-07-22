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
import type { Router } from "./router/Router";
import { modelCostMapService } from "./cost/ModelCostMapService";

/** 测试可控的 DB 配置参数（dbConfigProvider mock 数据源），每个用例前重置 */
const mockConfigParams: Record<string, Record<string, unknown>> = {};
/** 测试可控的 LiteLLM_ProxyModelTable 行（Database mock 数据源），每个用例前重置 */
const mockDbModelRows: Array<Record<string, unknown>> = [];

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

// Database 初始化依赖真实 PostgreSQL，容器装配测试仅需验证 RouterConfig 接线，
// mock 掉 Database 避免真实连接；select().from() 返回 mockDbModelRows（DB 模型回灌路径）
jest.mock("./core/db/Database", () => ({
	Database: jest.fn().mockImplementation(() => ({
		initialize: jest.fn().mockResolvedValue(undefined),
		db: {
			select: jest.fn(() => ({
				from: jest.fn(() => Promise.resolve(mockDbModelRows)),
			})),
		},
	})),
}));

beforeEach(() => {
	for (const key of Object.keys(mockConfigParams)) {
		delete mockConfigParams[key];
	}
	mockDbModelRows.length = 0;
});

/**
 * 读取 Router 私有字段（仅测试用，与 RouterExecution.test.ts 同模式）
 * @param router
 */
function routerInternals(router: Router): { _preCallChecks: boolean; _maxFallbacks: number } {
	return router as unknown as { _preCallChecks: boolean; _maxFallbacks: number };
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
		const internals = routerInternals(container.router);
		expect(internals._preCallChecks).toBe(true);
		expect(internals._maxFallbacks).toBe(10);
	});

	it("缺省时走 Router 默认（preCallChecks=false / maxFallbacks=5）", async () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
		});
		const container = await createServiceContainer(config);
		const internals = routerInternals(container.router);
		expect(internals._preCallChecks).toBe(false);
		expect(internals._maxFallbacks).toBe(5);
	});

	it("config 生成的 sha256 deployment id 流入 Router deployments", async () => {
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
		const container = await createServiceContainer(config);
		const deployments = container.router.getDeployments();
		expect(deployments).toHaveLength(1);
		expect(deployments[0]?.model_info?.id).toBe("5e49c98b2ca1d95217d90738a5778fd169efd1c24299c69d1e2419939ae92b78");
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
		const internals = container.router as unknown as { _numRetries: number };
		expect(internals._numRetries).toBe(7);
		expect(container.router.getNextFallback("gpt-5", 0)).toBe("gpt-5-mini");
	});

	it("DB 无 router_settings 时 yaml 值保持生效", async () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
			router_settings: { num_retries: 4 },
		});
		const container = await createServiceContainer(config);
		const internals = container.router as unknown as { _numRetries: number };
		expect(internals._numRetries).toBe(4);
	});

	it("DB router_settings 含非法 routing_strategy 时启动不崩溃，yaml 值保留", async () => {
		mockConfigParams["router_settings"] = { routing_strategy: "not-a-strategy", num_retries: 9 };
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-test" } }],
			router_settings: { num_retries: 2 },
		});
		const container = await createServiceContainer(config);
		// updateSettings 整体在 try/catch 内失败：yaml num_retries 保留
		const internals = container.router as unknown as { _numRetries: number };
		expect(internals._numRetries).toBe(2);
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
		expect(container.router.hasModel("db-only-model")).toBe(true);
		const dbDeployment = container.router.getDeployment("db-model-1");
		expect(dbDeployment?.model_info?.id).toBe("db-model-1");
		expect((dbDeployment?.model_info as Record<string, unknown> | undefined)?.["db_model"]).toBe(true);
	});

	it("DB 模型回灌：同 model_id DB 优先（替换 yaml deployment 的 litellm_params）", async () => {
		const yamlConfig = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5", api_key: "sk-yaml" } }],
		});
		// 先装配一次拿到 yaml deployment 的生成 id
		const baseline = await createServiceContainer(yamlConfig);
		const yamlDeploymentId = baseline.router.getDeployments()[0]?.model_info?.id;
		expect(typeof yamlDeploymentId).toBe("string");

		mockDbModelRows.push({
			model_id: yamlDeploymentId,
			model_name: "gpt-5",
			litellm_params: { model: "openai/gpt-5", api_key: "sk-db-override" },
			model_info: {},
		});
		const container = await createServiceContainer(yamlConfig);
		const deployments = container.router.getDeployments();
		expect(deployments).toHaveLength(1);
		expect(deployments[0]?.litellm_params["api_key"]).toBe("sk-db-override");
	});
});
