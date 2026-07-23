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

	// 3. 构建 Router 并创建 Router
	// 运行时配置来源：DB 优先，yaml 仅作缺省回退。
	// Router 构造时使用安全默认值，所有运行时设置通过 updateSettings 统一灌入。
	// 模型配置仅来自数据库（LiteLLM_ProxyModelTable）。
	const router = new LiteLLMRouter(
		{
			model_list: [],
			routing_strategy: RoutingStrategyName.LatencyBasedRouting,
			num_retries: 2,
			pre_call_checks: false,
		},
		{}, // modelGroupAlias 通过 updateSettings 从 DB/yaml 注入
	);

	// 3.1 运行时设置：yaml 为基线，DB router_settings 覆盖（DB 优先）。
	// 对齐 Python _add_router_settings_from_db_config（proxy_server.py:4023-4066）。
	const yamlRouterSettings: Record<string, unknown> = {};
	if (config.routerSettings.routing_strategy) {
		yamlRouterSettings["routing_strategy"] = config.routerSettings.routing_strategy;
	}
	if (config.routerSettings.num_retries != null) {
		yamlRouterSettings["num_retries"] = config.routerSettings.num_retries;
	}
	if (config.routerSettings.allowed_fails != null) {
		yamlRouterSettings["allowed_fails"] = config.routerSettings.allowed_fails;
	}
	if (config.routerSettings.cooldown_time != null) {
		yamlRouterSettings["cooldown_time"] = config.routerSettings.cooldown_time;
	}
	if (config.routerSettings.fallbacks.length > 0) {
		yamlRouterSettings["fallbacks"] = config.routerSettings.fallbacks;
	}
	if (config.routerSettings.enable_pre_call_checks != null) {
		yamlRouterSettings["enable_pre_call_checks"] = config.routerSettings.enable_pre_call_checks;
	}
	if (config.routerSettings.max_fallbacks != null) {
		yamlRouterSettings["max_fallbacks"] = config.routerSettings.max_fallbacks;
	}
	// model_group_alias：合并 general_settings 与 router_settings 中的别名配置
	const yamlModelGroupAlias = {
		...config.generalSettings.model_group_alias,
		...config.routerSettings.model_group_alias,
	};
	if (Object.keys(yamlModelGroupAlias).length > 0) {
		yamlRouterSettings["model_group_alias"] = yamlModelGroupAlias;
	}

	const dbRouterSettings = dbConfigProvider.getParam("router_settings");
	// DB 优先覆盖 yaml
	const mergedRouterSettings = { ...yamlRouterSettings, ...dbRouterSettings };
	if (Object.keys(mergedRouterSettings).length > 0) {
		try {
			router.updateSettings(mergedRouterSettings);
			logger.info("Router 运行时设置已加载", {
				source: Object.keys(dbRouterSettings).length > 0 ? "DB" : "yaml",
				keys: Object.keys(mergedRouterSettings),
			});
		} catch (error) {
			logger.error("Router 运行时设置应用失败", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// 3.2 DB 模型加载：Router 运行时模型配置的唯一来源。
	// 对齐 Python store_model_in_db 启动加载（proxy_server.py add_deployment →
	// llm_router.upsert_deployment）。
	try {
		const dbModels = await db.db.select().from(LiteLLM_ProxyModelTable);
		for (const row of dbModels) {
			router.upsertDeployment(proxyModelRowToDeployment(row));
		}
		if (dbModels.length > 0) {
			logger.info("DB 模型已加载到 Router", { count: dbModels.length });
		} else {
			logger.warn("DB 中无模型配置，请通过 WebUI 设置或导入 yaml 模型");
		}
	} catch (error) {
		// DB 查询失败（全新部署表不存在等）：Router 无模型，所有请求将返回 no-deployments 错误
		logger.error("DB 模型加载失败，Router 无可用模型", {
			error: error instanceof Error ? error.message : String(error),
		});
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
