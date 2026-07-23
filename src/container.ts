/**
 * 服务容器
 * 集中管理所有运行时服务实例的创建和生命周期
 */

import { Database } from "./core/db/Database";
import type { ProviderRegistry } from "./providers/ProviderRegistry";
import { defaultProviderRegistry } from "./providers/ProviderRegistry";
import { Router as LiteLLMRouter } from "./router/Router";
import { RoutingStrategyName } from "./types/router";
import { AuthRepository } from "./auth/AuthRepository";
import { JWTHandler } from "./auth/JWTHandler";
import { createApiKeyAuth } from "./auth/UserApiKeyAuth";
import { AuthorizationGuard } from "./auth/AuthorizationGuard";
import { LiteLLM_ProxyModelTable } from "./db/schema/proxyModels";
import { proxyModelRowToDeployment } from "./router/ProxyModelDeployment";
import { createModuleLogger } from "./core/utils/logger";
import type { ServiceConfig } from "./core/config";
import type { RequestHandler } from "express";
import { modelCostMapService, type ModelCostMapService } from "./cost/ModelCostMapService";

const logger = createModuleLogger("Container");

/** WebUI 登录后 cookie 中 JWT 的有效期（与 LoginEndpoints 保持一致） */
const LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;

/** 服务容器接口 */
export interface ServiceContainer {
	/** 数据库实例，提供 ORM 访问能力 */
	readonly db: Database;
	/** Provider 注册表，管理所有 LLM 提供商 */
	readonly providerRegistry: ProviderRegistry;
	/** 模型路由实例，处理请求分发 */
	readonly router: LiteLLMRouter;
	/** 运行时模型价格快照服务 */
	readonly modelCostMapService: ModelCostMapService;
	/** 认证仓库，提供 API 密钥和用户查询 */
	readonly authRepository: AuthRepository;
	/** Express 认证中间件 */
	readonly authMiddleware: RequestHandler;
	/** 集中路由与对象授权边界 */
	readonly authorizationGuard: AuthorizationGuard;
}

/**
 * 创建服务容器——按依赖顺序初始化所有组件
 * 1. Database
 * 2. ProviderRegistry (注册默认 provider)
 * 3. Router (传入 model_list + fallbacks + model_group_alias)
 * 4. AuthRepository
 * 5. Auth middleware
 * @param config
 */
export async function createServiceContainer(config: ServiceConfig): Promise<ServiceContainer> {
	// 1. 初始化数据库
	const db = new Database(config.database);
	await db.initialize();

	// 1.1 价格快照初始化：远端异常由服务内部回退 bundled，不阻断代理启动。
	await modelCostMapService.initialize();

	// 1.5 加载 DB 配置覆盖（LiteLLM_Config 表：store_prompts/logo/callbacks 等
	// WebUI 设置项，对齐 Python proxy_config.get_config() 的 DB 合并语义）
	const { dbConfigProvider } = await import("./core/config/DbConfigProvider");
	await dbConfigProvider.initialize(db.db);

	// 1.6 批次 E2：yaml ↔ DB 配置差异检测（yaml 快照 hash 比对 + 全量 diff），
	// 结果存内存 pending 列表，供 WebUI 差异对比窗口（/config/yaml_diff）消费。
	const { yamlConfigDiffService } = await import("./core/config/YamlConfigDiffService");
	await yamlConfigDiffService.initialize(db.db);

	// 2. ProviderRegistry — 注册默认实例（ProviderRegistry 自身不维护静态注册表，
	//    getProvider 动态创建；保留 defaultProviderRegistry 供已有使用者）
	//    ProviderRegistry 各 provider 的默认 API base 已由类内置。
	const providerRegistry = defaultProviderRegistry;

	// 3. 构建 RouterConfig 并创建 Router
	// 注意：必须把 config 中的 model_info 透传给每个 deployment，
	// 否则 /v2/model/info、/model_group/info 等 WebUI 端点拿不到 id/mode/tpm/rpm/cost 等元信息。
	// 同时把 deployment.litellm_params 全部 Python 字段透传（包括 api_base / api_key /
	// custom_llm_provider / extra_headers / extra_body / anthropic_version / 等），
	// 让 Router 在 getAvailableDeployment 时把 params 传给 ProviderRegistry，
	// 进一步传给 provider.transformRequest 作为 api_base / api_key 优先来源。
	const routerConfig = {
		model_list: config.modelList.map((m) => ({
			model_name: m.model_name,
			// 透传全部 Python litellm_params 字段（model 必填，其它按 Python 标准）
			litellm_params: { ...m.litellm_params },
			// 透传 model_info；空值时不写入字段以避免覆盖 Router 默认
			...(m.model_info && Object.keys(m.model_info).length > 0 ? { model_info: m.model_info } : {}),
		})),
		routing_strategy: (config.routerSettings.routing_strategy ?? RoutingStrategyName.LatencyBasedRouting) as RoutingStrategyName,
		num_retries: config.routerSettings.num_retries ?? 2,
		allowed_fails: config.routerSettings.allowed_fails,
		cooldown_time: config.routerSettings.cooldown_time,
		fallbacks: config.routerSettings.fallbacks.length > 0 ? config.routerSettings.fallbacks : undefined,
		request_timeout: config.routerSettings.request_timeout,
		// PY router_settings.enable_pre_call_checks → Router pre_call_checks：
		// 启用 TPM/RPM pre-reserve + max_input_tokens 校验，且 no-deployments 消息
		// 中 pre-call-checks=True（对齐 PY RouterRateLimitError 实测格式）
		pre_call_checks: config.routerSettings.enable_pre_call_checks,
		max_fallbacks: config.routerSettings.max_fallbacks,
	};

	const routerModelGroupAlias = {
		...config.generalSettings.model_group_alias,
		...config.routerSettings.model_group_alias,
	};

	const router = new LiteLLMRouter(routerConfig, routerModelGroupAlias);

	// 3.1 批次 C2：DB router_settings 覆盖 yaml（对齐 Python
	// _add_router_settings_from_db_config：_update_dictionary DB 优先后调
	// llm_router.update_settings，proxy_server.py:4023-4066）。
	// yaml 值已在构造时应用，这里只需把 DB 段灌入 updateSettings（白名单键覆盖）。
	const dbRouterSettings = dbConfigProvider.getParam("router_settings");
	if (Object.keys(dbRouterSettings).length > 0) {
		try {
			router.updateSettings(dbRouterSettings);
		} catch (error) {
			// DB 中非法值（如未知 routing_strategy）不应阻断启动，保留 yaml 生效值
			logger.warn("DB router_settings 应用失败，使用 yaml 配置", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// 3.2 批次 C2：DB 模型回灌（对齐 Python store_model_in_db 启动加载，
	// proxy_server.py add_deployment → llm_router.upsert_deployment）：
	// LiteLLM_ProxyModelTable 全量与 yaml modelList 合并，同 model_id DB 优先。
	try {
		const dbModels = await db.db.select().from(LiteLLM_ProxyModelTable);
		for (const row of dbModels) {
			router.upsertDeployment(proxyModelRowToDeployment(row));
		}
		if (dbModels.length > 0) {
			logger.info("DB 模型已回灌 Router", { count: dbModels.length });
		}
	} catch (error) {
		// LiteLLM_ProxyModelTable 不存在（全新部署）或查询失败：仅 yaml 模型生效
		logger.warn("DB 模型回灌失败，仅 yaml 模型生效", { error: error instanceof Error ? error.message : String(error) });
	}

	// 4. 创建 AuthRepository
	const authRepository = new AuthRepository(db.db);

	// 5. 创建认证中间件
	// WebUI 登录后 cookie 中的 token 是 HS256 JWT，用 master_key 签名；
	// 同步让 JWTHandler 以 master_key 作为 hmacSecret 验签（与 LoginEndpoints 一致）。
	const jwtHandler = new JWTHandler(undefined, undefined, LOGIN_TOKEN_TTL_MS, config.generalSettings.master_key);
	const authMiddleware = createApiKeyAuth(authRepository, config.generalSettings.master_key, jwtHandler);
	const authorizationGuard = new AuthorizationGuard(authRepository);

	return {
		db: db,
		providerRegistry: providerRegistry,
		router: router,
		modelCostMapService: modelCostMapService,
		authRepository: authRepository,
		authMiddleware: authMiddleware,
		authorizationGuard: authorizationGuard,
	};
}
