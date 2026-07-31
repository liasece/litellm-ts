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
import type { ServiceConfig } from "./core/config";
import type { RequestHandler } from "express";
import { modelCostMapService, type ModelCostMapService } from "./cost/ModelCostMapService";
import { CredentialSecretBox } from "./credentials/CredentialSecretBox";
import { CredentialService } from "./credentials/CredentialService";
import { CredentialRepository } from "./repositories/CredentialRepository";
import { DatabaseRuntimeConfigService } from "./core/config/DatabaseRuntimeConfigService";
import { ConfigRepository } from "./repositories/ConfigRepository";
import { CliProxyRuntimeManager } from "./cliproxy/CliProxyRuntimeManager";

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
	/** Credential 持久化与掩码服务 */
	readonly credentialService: CredentialService;
	/** 每请求从数据库读取 Router 配置的运行时服务 */
	readonly runtimeConfigService: DatabaseRuntimeConfigService;
	/** 内置 CLIProxy 二进制、配置、OAuth 文件与进程生命周期。 */
	readonly cliProxyRuntime: CliProxyRuntimeManager;
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

	// 2.1 Credential 必须先于 Router 和模型初始化，确保首次 Provider 请求即可解析命名凭据。
	const credentialRepository = new CredentialRepository(db.db);
	const legacyEncryptionKey = process.env["LITELLM_SALT_KEY"] ?? config.generalSettings.master_key;
	const legacySecretBox =
		legacyEncryptionKey === undefined || legacyEncryptionKey.length === 0 ? null : new CredentialSecretBox(legacyEncryptionKey);
	const credentialService = new CredentialService(credentialRepository, undefined, legacySecretBox);
	await credentialService.load();

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

	// 3.1 模型、Router 设置与凭据不再跨请求加载到 Router。
	// 每个需要 Router 的 HTTP 请求由 DatabaseRuntimeConfigService 建立一致的 DB 快照。
	const runtimeConfigService = new DatabaseRuntimeConfigService(db.db, config);

	// 3.2 CLIProxy 是 LiteLLM 托管的内部运行时。DB 是期望配置源，生成文件与
	// OAuth auth-dir 位于持久化卷；缺少 bootstrap binary 时不阻断网关启动。
	const cliProxyRuntime = new CliProxyRuntimeManager(new ConfigRepository(db.db), config.generalSettings.master_key);
	await cliProxyRuntime.initialize().catch((error: unknown) => {
		// Runtime status 保留具体错误，LiteLLM 其余 provider 仍可正常工作。
		console.error("CLIProxy runtime initialization failed", error);
	});

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
		credentialService: credentialService,
		runtimeConfigService: runtimeConfigService,
		cliProxyRuntime: cliProxyRuntime,
	};
}
