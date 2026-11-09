import { validateSpendMetadataFields } from "./spend/SpendMetadataFields";
import { validateKeyAliasSettings } from "./management/KeyAliasPolicy";
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
import { costTrackingConfigService } from "./cost/CostTrackingConfig";
import { CredentialSecretBox } from "./credentials/CredentialSecretBox";
import { CredentialService } from "./credentials/CredentialService";
import { CredentialRepository } from "./repositories/CredentialRepository";
import { DatabaseRuntimeConfigService } from "./core/config/DatabaseRuntimeConfigService";
import { ConfigRepository } from "./repositories/ConfigRepository";
import { CliProxyRuntimeManager } from "./cliproxy/CliProxyRuntimeManager";
import { ProviderQuotaService } from "./providerusage/ProviderQuotaService";
import { isCliProxyDeploymentParams } from "./cliproxy/CliProxyTypes";
import { parseSessionDuration } from "./proxy/LoginEndpoints";
import { DEFAULT_WEBUI_SESSION_DURATION, WEBUI_SESSION_DURATION_ENV_VAR } from "./types/webUiSession";
import { createModuleLogger } from "./core/utils/logger";
import { markTrace } from "./observability/RequestTrace";

const logger = createModuleLogger("ServiceContainer");

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
	/** 内置 Provider（DeepSeek / MiniMax）账户额度查询。 */
	readonly providerQuotaService: ProviderQuotaService;
	/**
	 * 并行预热不在启动关键路径上的外部依赖：远端模型价格快照与内置 CLIProxy 子进程。
	 *
	 * 两者都不是「可以开始监听」的前提：价格快照拉取失败本来就回退镜像内置数据，
	 * CLIProxy 是多秒级的子进程启动（生产实测 3.6 秒，健康等待上限 15 秒）。把它们
	 * 留在启动链上只会把外部网络和子进程时间叠加成服务的不可用窗口，因此改到监听
	 * 之后、与请求处理并行完成。失败只降级对应能力，不抛错；幂等，重复调用返回同
	 * 一个 Promise。
	 */
	readonly warmUp: () => Promise<void>;
}

/** 一个不在启动关键路径上、可以并行完成的预热任务。 */
interface WarmUpTask {
	/** 日志与耗时统计里的分段名 */
	readonly name: string;
	/** 幂等的预热动作；失败只影响对应能力 */
	readonly run: () => Promise<void>;
}

/**
 * 并行执行启动预热任务，并用一条结构化日志记录每段耗时。
 *
 * 预热的定义是「失败也不该拦启动」的外部依赖工作，因此这里的异常统一收敛成日志，
 * 让调用方可以无条件地 `void container.warmUp()`。
 * @param tasks - 需要并行完成的预热任务
 */
async function runWarmUp(tasks: readonly WarmUpTask[]): Promise<void> {
	const startedAt = Date.now();
	const stepsMs: Record<string, number> = {};
	const failures: Array<{ step: string; error: string }> = [];
	await Promise.all(
		tasks.map(async (task) => {
			const taskStartedAt = Date.now();
			try {
				await task.run();
			} catch (error) {
				failures.push({ step: task.name, error: error instanceof Error ? error.message : String(error) });
			}
			stepsMs[task.name] = Date.now() - taskStartedAt;
		}),
	);
	if (failures.length > 0) {
		failures.sort((left, right) => left.step.localeCompare(right.step));
		logger.error("启动预热未全部就绪", { totalMs: Date.now() - startedAt, steps: stepsMs, failures: failures });
		return;
	}
	logger.info("启动预热完成", { totalMs: Date.now() - startedAt, steps: stepsMs });
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

	// 1.5 加载 DB 配置覆盖（LiteLLM_Config 表：store_prompts/logo/callbacks 等
	// WebUI 设置项，对齐 Python proxy_config.get_config() 的 DB 合并语义）
	const { dbConfigProvider } = await import("./core/config/DbConfigProvider");
	dbConfigProvider.setDefaults({
		general_settings: config.generalSettingsRaw ?? {},
		litellm_settings: config.litellmSettingsRaw ?? {},
		router_settings: config.routerSettingsRaw ?? {},
	});
	await dbConfigProvider.initialize(db.db);
	validateSpendMetadataFields((await dbConfigProvider.getEffectiveParam("general_settings"))["spend_logs_metadata_fields"]);
	validateKeyAliasSettings(await dbConfigProvider.getEffectiveParam("litellm_settings"));

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
	// 升级 CLIProxy 前要等在途请求写完：这里把 Router 侧的 CLIProxy 在途计数接进排空逻辑。
	cliProxyRuntime.setActiveRequestProbe(() =>
		router.getActiveRequestCount((deployment) => isCliProxyDeploymentParams(deployment.litellm_params)),
	);
	// 这里的 initialize() 会安装/校验二进制、投影配置并等待子进程健康检查通过，
	// 不在关键路径上执行，交给 warmUp() 与监听并行；子进程状态仍在 runtime status 里。
	let warmUpPromise: Promise<void> | null = null;
	const warmUp = (): Promise<void> =>
		(warmUpPromise ??= runWarmUp([
			{
				name: "model_cost_map",
				run: async () => {
					await modelCostMapService.initialize();
				},
			},
			{ name: "cliproxy_runtime", run: () => cliProxyRuntime.initialize() },
			{ name: "cost_tracking_config", run: () => costTrackingConfigService.refresh(true) },
		]));

	// 4. 创建 AuthRepository
	const authRepository = new AuthRepository(db.db);

	// 5. 创建认证中间件
	// WebUI 登录 cookie 是用 master_key 签名的 HS256 JWT。会话默认 7 天滑动过期：
	// 已认证请求在临期窗口内同步延长 JWT cookie 和 DB session。
	const jwtHandler = new JWTHandler(undefined, undefined, undefined, config.generalSettings.master_key);
	const webUiSessionDurationSeconds = parseSessionDuration(process.env[WEBUI_SESSION_DURATION_ENV_VAR] ?? DEFAULT_WEBUI_SESSION_DURATION);
	const rawAuthMiddleware = createApiKeyAuth(authRepository, config.generalSettings.master_key, jwtHandler, undefined, {
		durationSeconds: webUiSessionDurationSeconds,
	});
	// 鉴权链每请求最多十余次串行 SELECT，是首字耗时里最大的一块本地开销；
	// 认证通过的那一刻打点，才能把这部分从「上游慢」里拆出来。鉴权失败不会走到 next。
	const authMiddleware: RequestHandler = (req, res, next) => {
		rawAuthMiddleware(req, res, (error?: unknown) => {
			if (error === undefined) {
				markTrace("auth_done");
			}
			next(error);
		});
	};
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
		providerQuotaService: new ProviderQuotaService(),
		warmUp: warmUp,
	};
}
