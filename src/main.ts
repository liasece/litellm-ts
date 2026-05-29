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
import { loadConfig, type ServiceConfig } from "./core/config";
import { createServiceContainer, type ServiceContainer } from "./container";
import { registerController } from "./core/api/registerController";
import { errorHandler } from "./middleware/ErrorHandler";
import { accessLogFilter } from "./middleware/AccessLogFilter";
import { createModuleLogger } from "./core/utils/logger";
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
import { registerSSORoutes } from "./proxy/SSOEndpoints";
import { registerSpendIntegrationRoutes } from "./proxy/SpendIntegrationEndpoints";
import { registerOCRVideoContainerRoutes } from "./proxy/OCRVideoContainerEndpoints";
import { registerAnalyticsRoutes } from "./proxy/AnalyticsEndpoints";
import { registerAlertingRoutes } from "./proxy/AlertingEndpoints";
import { registerDiscoveryRoutes } from "./proxy/DiscoveryEndpoints";

const logger = createModuleLogger("Server");

/**
 * LiteLLM TS Gateway 服务器
 *
 * Express 服务器主类，负责配置加载、服务装配、中间件组装和路由注册。
 */
export class LiteLLMServer {
	private readonly _config: ServiceConfig;
	private _container: ServiceContainer | null = null;
	private readonly _app: express.Express;

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
		this._assemblyExpress();
		const server = this._app.listen(port, host, () => {
			logger.info(`LiteLLM TS Gateway 已启动: http://${host}:${port}`);
		});
		server.keepAliveTimeout = 120_000;
		server.headersTimeout = 121_000;
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
		app.use(express.json());
		app.use(accessLogFilter);

		// 注册路由
		this._registerHealthRoutes(app);
		this._registerCoreProxyRoutes(app, container);
		this._registerManagementRoutes(app, container);
		this._registerSpendRoutes(app, container);
		this._registerStubRoutes(app, container);

		// 全局错误处理
		app.use(errorHandler);
	}

	// ── 健康检查 ──
	private _registerHealthRoutes(app: express.Express): void {
		registerController(app, new HealthController());
		logger.info("健康检查路由已注册");
	}

	// ── 核心代理端点 ──
	private _registerCoreProxyRoutes(app: express.Express, container: ServiceContainer): void {
		const proxyRouter = express.Router();
		proxyRouter.use(container.authMiddleware);

		// Chat completions
		registerChatCompletionsRoutes(proxyRouter, container.router, container.db.db);
		// Embeddings
		registerEmbeddingsRoutes(proxyRouter, container.router);
		// Text completions
		registerCompletionsRoutes(proxyRouter, container.router);
		// Anthropic Messages
		registerAnthropicMessagesEndpoints(proxyRouter, container.router, undefined, container.db.db);
		// Models (decorator controller)
		registerController(proxyRouter, new ModelsController(container.router));
		// Moderations
		registerController(proxyRouter, new ModerationsController());
		// Audio
		registerController(proxyRouter, new AudioController());
		// Image
		registerController(proxyRouter, new ImageController());

		app.use(proxyRouter);
		logger.info("核心代理端点已注册");
	}

	// ── 管理端点 ──
	private _registerManagementRoutes(app: express.Express, container: ServiceContainer): void {
		const managementRouter = express.Router();
		managementRouter.use(container.authMiddleware);

		createKeyManagementRoutes(managementRouter, container.db.db, container.authMiddleware);
		createInternalUserRoutes(managementRouter, container.db.db, container.authMiddleware);
		createTeamRoutes(managementRouter, container.db.db, container.authMiddleware);
		createOrganizationRoutes(managementRouter, container.db.db, container.authMiddleware);
		createCustomerRoutes(managementRouter, container.db.db, container.authMiddleware);
		createModelManagementRoutes(managementRouter, container.db.db, container.authMiddleware);

		app.use(managementRouter);
		logger.info("管理端点已注册");
	}

	// ── 消费端点 ──
	private _registerSpendRoutes(app: express.Express, container: ServiceContainer): void {
		const spendRouter = express.Router();
		spendRouter.use(container.authMiddleware);
		registerSpendManagementEndpoints(spendRouter, container.db.db);
		app.use(spendRouter);
		logger.info("消费端点已注册");
	}

	// ── Stub 端点（28 个 LiteLLM API 表面） ──
	private _registerStubRoutes(app: express.Express, container: ServiceContainer): void {
		const stubRouter = express.Router();
		stubRouter.use(container.authMiddleware);

		registerAssistantsRoutes(stubRouter);
		registerBatchesRoutes(stubRouter);
		registerFilesRoutes(stubRouter);
		registerFineTuningRoutes(stubRouter);
		registerVectorStoreRoutes(stubRouter);
		registerResponsesApiRoutes(stubRouter);
		registerRerankRoutes(stubRouter);
		registerRealtimeRoutes(stubRouter);
		registerAgentRoutes(stubRouter);
		registerGoogleRoutes(stubRouter);
		registerMCPRoutes(stubRouter);
		registerSCIMRoutes(stubRouter);
		registerSearchToolsRoutes(stubRouter);
		registerPromptRoutes(stubRouter);
		registerPolicyRoutes(stubRouter);
		registerCredentialRoutes(stubRouter);
		registerToolRoutes(stubRouter);
		registerComplianceRoutes(stubRouter);
		registerAnthropicSkillsRoutes(stubRouter);
		registerClaudeCodeMarketplaceRoutes(stubRouter);
		registerUtilRoutes(stubRouter);
		registerLoginRoutes(stubRouter);
		registerSSORoutes(stubRouter);
		registerSpendIntegrationRoutes(stubRouter);
		registerOCRVideoContainerRoutes(stubRouter);
		registerAnalyticsRoutes(stubRouter);
		registerAlertingRoutes(stubRouter);
		registerDiscoveryRoutes(stubRouter);

		app.use(stubRouter);
		logger.info("Stub 端点已注册");
	}
}

async function main(): Promise<void> {
	const server = new LiteLLMServer();
	await server.start();
}

main().catch((err) => {
	logger.error("启动失败", { error: err });
	process.exit(1);
});
