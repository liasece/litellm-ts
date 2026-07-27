/**
 * LiteLLM TypeScript Gateway — 主入口
 *
 * Express 服务器装配：
 * 1. 加载 YAML 配置
 * 2. 创建服务容器 (DB, Router, Auth)
 * 3. 组装 Express 中间件链
 * 4. 注册所有路由
 * 5. 启动监听
 */
import express from "express";
import type { Server as HttpServer } from "node:http";
import { loadConfig, type ServiceConfig } from "./core/config";
import { createServiceContainer, type ServiceContainer } from "./container";
import { registerController } from "./core/api/registerController";
import { jsonBigIntReplacer } from "./core/api/jsonBigInt";
import { errorHandler } from "./middleware/ErrorHandler";
import { accessLogFilter } from "./middleware/AccessLogFilter";
import { createModuleLogger } from "./core/utils/logger";
import { registerStaticUiRoutes } from "./ui/StaticUiRoutes";
// 核心代理端点
import { HealthController } from "./proxy/HealthEndpoint";
import { ModelsController } from "./proxy/ModelsEndpoint";
import { registerChatCompletionsRoutes } from "./proxy/ChatCompletionsEndpoint";
import { registerEmbeddingsRoutes } from "./proxy/EmbeddingsEndpoint";
import { registerCompletionsRoutes } from "./proxy/CompletionsEndpoint";
import { registerAnthropicMessagesEndpoints } from "./proxy/AnthropicMessagesEndpoint";
import { ModerationsController } from "./proxy/ModerationsEndpoint";
import { AudioController } from "./proxy/AudioEndpoint";
import { ImageController } from "./proxy/ImageEndpoint";

// 管理端点
import { createKeyManagementRoutes } from "./management/KeyManagementEndpoint";
import { createInternalUserRoutes } from "./management/InternalUserEndpoint";
import { createTeamRoutes } from "./management/TeamEndpoint";
import { createOrganizationRoutes } from "./management/OrganizationEndpoint";
import { createCustomerRoutes } from "./management/CustomerEndpoint";
import { createModelManagementRoutes } from "./management/ModelManagementEndpoint";

// 消费端点
import { registerSpendManagementEndpoints } from "./spend/SpendManagementEndpoint";

// Stub 端点（28 个 LiteLLM API 表面）
import { registerAssistantsRoutes } from "./proxy/AssistantsEndpoints";
import { registerBatchesRoutes } from "./proxy/BatchesEndpoints";
import { registerFilesRoutes } from "./proxy/FilesEndpoints";
import { registerFineTuningRoutes } from "./proxy/FineTuningEndpoints";
import { registerVectorStoreRoutes } from "./proxy/VectorStoreEndpoints";
import { registerResponsesApiRoutes } from "./proxy/ResponsesApiEndpoints";
import { registerRerankRoutes } from "./proxy/RerankEndpoints";
import { registerRealtimeRoutes } from "./proxy/RealtimeEndpoints";
import { registerAgentRoutes } from "./proxy/AgentEndpoints";
import { registerGoogleRoutes } from "./proxy/GoogleEndpoints";
import { registerMCPRoutes } from "./proxy/MCPEndpoints";
import { registerSCIMRoutes } from "./proxy/SCIMEndpoints";
import { registerSearchToolsRoutes } from "./proxy/SearchToolsEndpoints";
import { registerPromptRoutes } from "./proxy/PromptEndpoints";
import { registerPolicyRoutes } from "./proxy/PolicyEndpoints";
import { registerCredentialRoutes } from "./proxy/CredentialEndpoints";
import { registerToolRoutes } from "./proxy/ToolEndpoints";
import { registerComplianceRoutes } from "./proxy/ComplianceEndpoints";
import { registerAnthropicSkillsRoutes } from "./proxy/AnthropicSkillsEndpoints";
import { registerClaudeCodeMarketplaceRoutes } from "./proxy/ClaudeCodeMarketplaceEndpoints";
import { registerUtilRoutes } from "./proxy/UtilEndpoints";
import { registerLoginRoutes } from "./proxy/LoginEndpoints";
import { webUiCsrfProtection } from "./auth/UserApiKeyAuth";
import { registerSSORoutes } from "./proxy/SSOEndpoints";
import { registerSpendIntegrationRoutes } from "./proxy/SpendIntegrationEndpoints";
import { registerConfigOverridesRoutes } from "./proxy/ConfigOverridesEndpoints";
import { registerEmailEventsRoutes } from "./proxy/EmailEventsEndpoints";
import { registerIpAllowlistRoutes } from "./proxy/IpAllowlistEndpoints";
import { registerOCRVideoContainerRoutes } from "./proxy/OCRVideoContainerEndpoints";
import { registerAnalyticsRoutes } from "./proxy/AnalyticsEndpoints";
import { registerAlertingRoutes } from "./proxy/AlertingEndpoints";
import { registerDiscoveryRoutes } from "./proxy/DiscoveryEndpoints";
import { registerWebUiSupportPublicRoutes, registerWebUiSupportRoutes } from "./proxy/WebUiSupportEndpoints";
import { registerModelsPageSupportRoutes } from "./proxy/ModelsPageSupportEndpoints";
import { abortOrphanedActiveRequests } from "./spend/ActiveRequestRecovery";

const logger = createModuleLogger("Server");

/** Claude Code 启动请求会携带较大的系统提示与工具定义，需对齐 LiteLLM 代理的大请求体入口。 */
const REQUEST_BODY_LIMIT = "50mb";

/**
 * LiteLLM TS Gateway 服务器
 *
 * Express 服务器主类，负责配置加载、服务装配、中间件组装和路由注册。
 */
export class LiteLLMServer {
	private readonly _config: ServiceConfig;
	private _container: ServiceContainer | null = null;
	private readonly _app: express.Express;
	private _httpServer: HttpServer | null = null;
	private _stopPromise: Promise<void> | null = null;

	constructor() {
		this._config = loadConfig();
		this._app = express();
	}

	/**
	 * 启动服务器，监听指定端口和主机
	 */
	async start(): Promise<void> {
		const port = this._config.server.port;
		const host = this._config.server.host;

		logger.info("LiteLLM TS Gateway 启动中...", { port: port, host: host, modelCount: this._config.modelList.length });

		this._container = await createServiceContainer(this._config);
		const abortedRequestCount = await abortOrphanedActiveRequests(this._container.db.db);
		if (abortedRequestCount > 0) {
			logger.warn("已将旧进程遗留的在途请求标记为 aborted", { requestCount: abortedRequestCount });
		}
		this._assemblyExpress();
		await new Promise<void>((resolve, reject) => {
			const server = this._app.listen(port, host, () => {
				server.off("error", reject);
				this._httpServer = server;
				logger.info(`LiteLLM TS Gateway 已启动: http://${host}:${port}`);
				resolve();
			});
			server.once("error", reject);
			server.keepAliveTimeout = 120_000;
			server.headersTimeout = 121_000;
		});
	}

	/**
	 * 停止接收新连接，等待现有 HTTP 请求结束后关闭数据库。
	 * 未能在外部宽限期内结束的请求由下一进程启动扫描标记为 aborted。
	 */
	async stop(): Promise<void> {
		if (this._stopPromise) {
			return this._stopPromise;
		}
		this._stopPromise = (async () => {
			const httpServer = this._httpServer;
			this._httpServer = null;
			if (httpServer) {
				await new Promise<void>((resolve, reject) => {
					httpServer.close((error) => {
						if (error) {
							reject(error);
							return;
						}
						resolve();
					});
				});
			}
			await this._container?.db.close();
		})();
		return this._stopPromise;
	}

	/** 获取 Express 应用实例 */
	get app(): express.Express {
		return this._app;
	}

	/** 获取服务容器实例 */
	get container(): ServiceContainer | null {
		return this._container;
	}

	private _assemblyExpress(): void {
		const app = this._app;
		const container = this._container!;

		// 全局中间件
		app.set("json replacer", jsonBigIntReplacer);
		app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
		app.use(accessLogFilter);

		// 注册路由
		this._registerHealthRoutes(app);
		this._registerPublicProxyRoutes(app);
		// WebUI 静态资源必须在鉴权 API 路由之前注册，避免被 API 路由抢先匹配
		registerStaticUiRoutes(app);
		this._registerCoreProxyRoutes(app, container);
		this._registerManagementRoutes(app, container);
		this._registerSpendRoutes(app, container);
		this._registerStubRoutes(app, container);

		// 全局错误处理
		app.use(errorHandler);
	}

	// ── 健康检查 ──
	private _registerHealthRoutes(app: express.Express): void {
		const container = this._container!;
		const healthRouter = express.Router();
		const runtimeConfigMiddleware = container.runtimeConfigService.middleware(container.router);
		healthRouter.use((req, res, next) => {
			if (req.path === "/health/liveliness" || req.path === "/health/liveness") {
				next();
				return;
			}
			runtimeConfigMiddleware(req, res, next);
		});
		registerController(healthRouter, new HealthController(container.router, container.db), { requireAuth: container.authMiddleware });
		app.use(healthRouter);
		logger.info("健康检查路由已注册");
	}

	// ── 公开代理端点 ──
	private _registerPublicProxyRoutes(app: express.Express): void {
		const publicRouter = express.Router();
		const container = this._container!;
		registerLoginRoutes(
			publicRouter,
			this._config,
			container.db.db,
			container.authMiddleware,
			webUiCsrfProtection,
			container.authRepository,
		);
		registerDiscoveryRoutes(publicRouter);
		registerWebUiSupportPublicRoutes(publicRouter, this._container!.modelCostMapService);
		publicRouter.get("/", (_req, res) => {
			res.redirect("/ui");
		});
		app.use(publicRouter);
		logger.info("公开代理端点已注册");
	}

	// ── 核心代理端点 ──
	private _registerCoreProxyRoutes(app: express.Express, container: ServiceContainer): void {
		const proxyRouter = express.Router();
		proxyRouter.use(container.authMiddleware);
		proxyRouter.use(webUiCsrfProtection);
		proxyRouter.use(container.authorizationGuard.middleware("inference"));
		proxyRouter.use(container.runtimeConfigService.middleware(container.router));

		// Chat completions
		registerChatCompletionsRoutes(proxyRouter, container.router, container.db.db);
		// Embeddings
		registerEmbeddingsRoutes(proxyRouter, container.router, container.db.db);
		// Text completions
		registerCompletionsRoutes(proxyRouter, container.router, container.db.db);
		// Anthropic Messages
		registerAnthropicMessagesEndpoints(proxyRouter, container.router, undefined, container.db.db);
		// Models (decorator controller)
		registerController(proxyRouter, new ModelsController(container.router));
		// Moderations
		registerController(proxyRouter, new ModerationsController());
		// Audio
		registerController(proxyRouter, new AudioController(container.router, container.db.db));
		// Image
		registerController(proxyRouter, new ImageController(container.router, container.db.db));

		app.use(proxyRouter);
		logger.info("核心代理端点已注册");
	}

	// ── 管理端点 ──
	private _registerManagementRoutes(app: express.Express, container: ServiceContainer): void {
		const managementRouter = express.Router();
		managementRouter.use(container.authMiddleware);
		managementRouter.use(webUiCsrfProtection);
		managementRouter.use(container.authorizationGuard.middleware("management"));

		createKeyManagementRoutes(managementRouter, container.db.db, container.authorizationGuard);
		createInternalUserRoutes(managementRouter, container.db.db, null);
		createTeamRoutes(managementRouter, container.db.db, null);
		createOrganizationRoutes(managementRouter, container.db.db, null);
		createCustomerRoutes(managementRouter, container.db.db, null);
		createModelManagementRoutes(managementRouter, container.db.db, null);

		app.use(managementRouter);
		logger.info("管理端点已注册");
	}

	// ── 消费端点 ──
	private _registerSpendRoutes(app: express.Express, container: ServiceContainer): void {
		const spendRouter = express.Router();
		spendRouter.use(container.authMiddleware);
		spendRouter.use(webUiCsrfProtection);
		spendRouter.use(container.authorizationGuard.middleware("spend"));
		registerSpendManagementEndpoints(spendRouter, container.db.db);
		app.use(spendRouter);
		logger.info("消费端点已注册");
	}

	// ── Stub 端点（28 个 LiteLLM API 表面） ──
	private _registerStubRoutes(app: express.Express, container: ServiceContainer): void {
		const stubRouter = express.Router();
		stubRouter.use(container.authMiddleware);
		stubRouter.use(webUiCsrfProtection);
		stubRouter.use(container.authorizationGuard.middleware("authenticated"));
		stubRouter.use(container.runtimeConfigService.middleware(container.router));

		// Models 页面支撑（需鉴权）
		// 必须传 container.router：Router deployments 是运行时真实模型源，
		// 包含 config 重构过程中可能丢失的 model_info 字段与默认 deployment 元信息
		// （如 custom_llm_provider、rpm/tpm、timeout 等）。如果只传 config.modelList，
		// /v2/model/info 与 /model_group/info 拿不到 id / mode / cost 等关键字段。
		registerModelsPageSupportRoutes(stubRouter, container.router, this._config, container.modelCostMapService);

		// WebUI 鉴权支撑端点（/get/ui_settings、/config/list、/config/update、/team/list 等）
		registerWebUiSupportRoutes(stubRouter, this._config, container.db.db, container.router);

		registerAssistantsRoutes(stubRouter);
		registerBatchesRoutes(stubRouter);
		registerFilesRoutes(stubRouter);
		registerFineTuningRoutes(stubRouter);
		registerVectorStoreRoutes(stubRouter);
		registerResponsesApiRoutes(stubRouter, container.router, container.db.db);
		registerRerankRoutes(stubRouter);
		registerRealtimeRoutes(stubRouter);
		registerAgentRoutes(stubRouter);
		registerGoogleRoutes(stubRouter);
		registerMCPRoutes(stubRouter);
		registerSCIMRoutes(stubRouter);
		registerSearchToolsRoutes(stubRouter, container.db.db);
		registerPromptRoutes(stubRouter);
		registerPolicyRoutes(stubRouter);
		registerCredentialRoutes(stubRouter, container.credentialService, container.router);
		registerToolRoutes(stubRouter);
		registerComplianceRoutes(stubRouter);
		registerAnthropicSkillsRoutes(stubRouter);
		registerClaudeCodeMarketplaceRoutes(stubRouter, container.db.db);
		registerUtilRoutes(stubRouter);
		registerSSORoutes(stubRouter);
		registerSpendIntegrationRoutes(stubRouter);
		registerConfigOverridesRoutes(stubRouter);
		registerEmailEventsRoutes(stubRouter);
		registerIpAllowlistRoutes(stubRouter);
		registerOCRVideoContainerRoutes(stubRouter);
		registerAnalyticsRoutes(stubRouter);
		registerAlertingRoutes(stubRouter);

		app.use(stubRouter);
		logger.info("Stub 端点已注册");
	}
}

async function main(): Promise<void> {
	const server = new LiteLLMServer();
	await server.start();

	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals): void => {
		if (shuttingDown) {
			return;
		}
		shuttingDown = true;
		logger.info("收到退出信号，停止接收新请求并等待在途请求完成", { signal: signal });
		void server
			.stop()
			.then(() => {
				logger.info("LiteLLM TS Gateway 已安全停止", { signal: signal });
				process.exit(0);
			})
			.catch((error: unknown) => {
				logger.error("LiteLLM TS Gateway 停止失败", { error: error, signal: signal });
				process.exit(1);
			});
	};
	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
	logger.error("启动失败", { error: err });
	process.exit(1);
});
