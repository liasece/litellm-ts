/**
 * 服务容器
 * 集中管理所有运行时服务实例的创建和生命周期
 */

import { Database } from "./core/db/Database";
import type { ProviderRegistry } from "./providers/ProviderRegistry";
import { defaultProviderRegistry } from "./providers/ProviderRegistry";
import { Router as LiteLLMRouter } from "./router/Router";
import type { RoutingStrategy } from "./types/router";
import { AuthRepository } from "./auth/AuthRepository";
import { createApiKeyAuth } from "./auth/UserApiKeyAuth";
import type { ServiceConfig } from "./core/config";
import type { RequestHandler } from "express";

/** 服务容器接口 */
export interface ServiceContainer {
	/** 数据库实例，提供 ORM 访问能力 */
	readonly db: Database;
	/** Provider 注册表，管理所有 LLM 提供商 */
	readonly providerRegistry: ProviderRegistry;
	/** 模型路由实例，处理请求分发 */
	readonly router: LiteLLMRouter;
	/** 认证仓库，提供 API 密钥和用户查询 */
	readonly authRepository: AuthRepository;
	/** Express 认证中间件 */
	readonly authMiddleware: RequestHandler;
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

	// 2. ProviderRegistry — 注册默认实例（ProviderRegistry 自身不维护静态注册表，
	//    getProvider 动态创建；保留 defaultProviderRegistry 供已有使用者）
	//    ProviderRegistry 各 provider 的默认 API base 已由类内置。
	const providerRegistry = defaultProviderRegistry;

	// 3. 构建 RouterConfig 并创建 Router
	const routerConfig = {
		model_list: config.modelList.map((m) => ({
			model_name: m.model_name,
			litellm_params: {
				model: m.litellm_params.model,
				api_key: m.litellm_params.api_key,
				api_base: m.litellm_params.api_base,
				custom_llm_provider: m.litellm_params.custom_llm_provider,
				rpm: m.litellm_params.rpm,
				tpm: m.litellm_params.tpm,
				input_cost_per_token: m.litellm_params.input_cost_per_token,
				output_cost_per_token: m.litellm_params.output_cost_per_token,
				timeout: m.litellm_params.timeout,
				max_retries: m.litellm_params.max_retries,
			},
		})),
		routing_strategy: (config.routerSettings.routing_strategy ?? "latency-based") as RoutingStrategy,
		num_retries: config.routerSettings.num_retries ?? 2,
		allowed_fails: config.routerSettings.allowed_fails,
		cooldown_time: config.routerSettings.cooldown_time,
		fallbacks: config.routerSettings.fallbacks.length > 0 ? config.routerSettings.fallbacks : undefined,
		request_timeout: config.routerSettings.request_timeout,
	};

	const routerModelGroupAlias = {
		...config.generalSettings.model_group_alias,
		...config.routerSettings.model_group_alias,
	};

	const router = new LiteLLMRouter(routerConfig, routerModelGroupAlias);

	// 4. 创建 AuthRepository
	const authRepository = new AuthRepository(db.db);

	// 5. 创建认证中间件
	const authMiddleware = createApiKeyAuth(authRepository, config.generalSettings.master_key);

	return {
		db: db,
		providerRegistry: providerRegistry,
		router: router,
		authRepository: authRepository,
		authMiddleware: authMiddleware,
	};
}
