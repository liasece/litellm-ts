import { sseKeepaliveMiddleware } from "./proxy/SseKeepalive";
import { registerEntityPatchRoutes } from "./management/EntityPatchEndpoints";
import { codingClientModelMiddleware } from "./proxy/CodingClientModels";
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
import { requestArrivalMiddleware } from "./core/api/RequestArrival";
import { errorHandler } from "./middleware/ErrorHandler";
import { zstdRequestDecompress } from "./middleware/ZstdRequestDecompress";
import { accessLogFilter } from "./middleware/AccessLogFilter";
import { upstreamExchangeScope } from "./middleware/UpstreamExchangeScope";
import { spendResponseCompression } from "./middleware/SpendResponseCompression";
import { httpMetricsMiddleware, markBodyParsed } from "./observability/HttpMetrics";
import { registerObservabilityRoutes } from "./observability/ObservabilityController";
import { runtimeMetricsSampler } from "./observability/RuntimeMetrics";
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

// 兼容端点（WebUI 支撑、别名与保留 API 表面）
import { registerResponsesApiRoutes } from "./proxy/ResponsesApiEndpoints";
import { registerSearchToolsRoutes } from "./proxy/SearchToolsEndpoints";
import { registerCredentialRoutes } from "./proxy/CredentialEndpoints";
import { registerUtilRoutes } from "./proxy/UtilEndpoints";
import { registerLoginRoutes } from "./proxy/LoginEndpoints";
import { webUiCsrfProtection } from "./auth/UserApiKeyAuth";
import { registerDiscoveryRoutes } from "./proxy/DiscoveryEndpoints";
import { registerWebUiSupportPublicRoutes, registerWebUiSupportRoutes } from "./proxy/WebUiSupportEndpoints";
import { registerModelsPageSupportRoutes } from "./proxy/ModelsPageSupportEndpoints";
import { registerCostTrackingRoutes } from "./proxy/CostTrackingEndpoints";
import { registerPrivacyRoutes } from "./proxy/PrivacyEndpoints";
import { privacyMaskingMiddleware } from "./privacy/PrivacyMiddleware";
import { abortOrphanedActiveRequests, reapExpiredActiveRequests } from "./spend/ActiveRequestRecovery";
import { registerCliProxyManagementRoutes } from "./cliproxy/CliProxyEndpoints";
import { registerSubscriptionSpecialRoutes } from "./subscriptions/native/SubscriptionSpecialEndpoints";
import { registerProviderQuotaRoutes } from "./proxy/ProviderQuotaEndpoints";
import { registerSpendLogStreamWebSocket } from "./spend/logStreamWebSocket";
import { authRepositoryCache, logAuthCacheConfiguration } from "./auth/AuthRepositoryCache";
import { registerSubscriptionResponsesWebSocket } from "./subscriptions/native/SubscriptionResponsesWebSocket";
import { registerSpendLogUpdatesWebSocket } from "./spend/logUpdatesWebSocket";
import { registerSpendSessionTimelineStreamWebSocket } from "./spend/sessionTimelineWebSocket";

const logger = createModuleLogger("Server");

/** Claude Code 启动请求会携带较大的系统提示与工具定义，需对齐 LiteLLM 代理的大请求体入口。 */
const REQUEST_BODY_LIMIT = "200mb";

/** 在途请求租约巡检周期（毫秒）：与 ACTIVE_REQUEST_LEASE_MS 的 1/3 同量级。 */
const ACTIVE_REQUEST_REAPER_INTERVAL_MS = 5 * 60 * 1000;

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
	/** 在途请求租约巡检定时器；unref 后不阻止进程退出。 */
	private _activeRequestReaper: NodeJS.Timeout | null = null;

	constructor() {
		this._config = loadConfig();
		this._app = express();
	}

	/**
	 * 启动服务器，监听指定端口和主机
	 */
	async start(): Promise<void> {
		// 运行指标采集先于监听启动，启动阶段的事件循环停顿与内存峰值也要能看见。
		runtimeMetricsSampler.start();
		const startedAt = Date.now();
		const port = this._config.server.port;
		const host = this._config.server.host;

		logger.info("LiteLLM TS Gateway 启动中...", { port: port, host: host, modelCount: this._config.modelList.length });

		this._container = await createServiceContainer(this._config);
		// 缓存是「可关」的运维开关，启动时打一条配置，线上可直接从日志确认是否生效。
		logAuthCacheConfiguration();
		// 预热与启动收尾并行：远端模型价格快照和订阅设置投影都不是监听的前提，
		// 在这里尽早开始，它们的耗时（及各自超时预算）不再计入服务不可用窗口。
		void this._container.warmUp();
		const abortedRequestCount = await abortOrphanedActiveRequests(this._container.db.db);
		if (abortedRequestCount > 0) {
			logger.warn("已将旧进程遗留的在途请求标记为 aborted", { requestCount: abortedRequestCount });
		}
		this._startActiveRequestReaper();
		this._assemblyExpress();
		await new Promise<void>((resolve, reject) => {
			const server = this._app.listen(port, host, () => {
				server.off("error", reject);
				this._httpServer = server;
				// 这里是「可以开始接受请求」的时刻，不含已在后台进行的预热。
				logger.info(`LiteLLM TS Gateway 已启动: http://${host}:${port}`, { startupMs: Date.now() - startedAt });
				resolve();
			});
			registerSpendLogStreamWebSocket(server, this._container!);
			registerSpendLogUpdatesWebSocket(server, this._container!);
			registerSubscriptionResponsesWebSocket(server, this._container!);
			registerSpendSessionTimelineStreamWebSocket(server, this._container!);
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
			if (this._activeRequestReaper !== null) {
				clearInterval(this._activeRequestReaper);
				this._activeRequestReaper = null;
			}
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
			runtimeMetricsSampler.stop();
			await this._container?.cliProxyRuntime.shutdown();
			await this._container?.db.close();
		})();
		return this._stopPromise;
	}

	/**
	 * 启动在途请求租约巡检。
	 *
	 * 活跃请求的心跳会持续续租 expires_at，因此只有心跳已停的孤儿行会过期。
	 * 没有这个巡检，孤儿行只能等下一次进程重启才被清掉，期间会永久占据
	 * LiteLLM_ActiveRequests 并被反复 UPDATE（生产曾累计 23 行、最老 100 分钟）。
	 * 扫描周期取租约的 1/3，与心跳节流保持同一量级。
	 */
	private _startActiveRequestReaper(): void {
		const timer = setInterval(() => {
			void reapExpiredActiveRequests(this._container!.db.db)
				.then((reaped) => {
					if (reaped > 0) {
						logger.warn("已回收租约过期的在途请求", { requestCount: reaped });
					}
				})
				.catch((error: unknown) => {
					logger.error("在途请求巡检失败", { error: error });
				});
		}, ACTIVE_REQUEST_REAPER_INTERVAL_MS);
		// 巡检不应阻止进程退出。
		timer.unref();
		this._activeRequestReaper = timer;
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
		// 记账口径的「请求到达」时刻必须先于一切中间件落地：SpendLog 的 startTime 与 Dashboard
		// 的 TTFT 都从这里起算，晚一步就会把 body 解析、鉴权与费用预留排除在 TTFT 之外。
		app.use(requestArrivalMiddleware);
		// 观测必须是第一个中间件之后的观测入口：「请求到达」时刻之后才有请求体解析、鉴权与路由的分解耗时。
		app.use(httpMetricsMiddleware);
		app.use(zstdRequestDecompress);
		app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
		// 请求体解析完成后打点，用于把「收包 + JSON 解析」从后续阶段里拆出来。
		app.use(markBodyParsed);
		app.use(accessLogFilter);
		// 上游交换旁路作用域：所有会发起上游调用的路由之前建立，日志层据此读取上游详情。
		app.use(upstreamExchangeScope);

		// 注册路由
		this._registerHealthRoutes(app);
		this._registerObservabilityRoutes(app);
		this._registerPublicProxyRoutes(app);
		// WebUI 静态资源必须在鉴权 API 路由之前注册，避免被 API 路由抢先匹配
		registerStaticUiRoutes(app);
		this._registerCoreProxyRoutes(app, container);
		this._registerManagementRoutes(app, container);
		this._registerPrivacyRoutes(app, container);
		this._registerProviderQuotaRoutes(app, container);
		this._registerSpendRoutes(app, container);
		this._registerStubRoutes(app, container);

		// 全局错误处理
		app.use(errorHandler);
	}

	// ── 观测端点 ──
	/**
	 * 注册 Prometheus 抓取、JSON 概览与慢请求明细端点。
	 * 三个端点都要求有效密钥：观测数据含模型名与流量分布，不属于公开信息。
	 * @param app - Express 应用
	 */
	private _registerObservabilityRoutes(app: express.Express): void {
		const container = this._container!;
		const observabilityRouter = express.Router();
		registerObservabilityRoutes(observabilityRouter, container.authMiddleware);
		app.use(observabilityRouter);
		logger.info("观测端点已注册", { paths: ["/metrics", "/metrics/summary", "/metrics/slow"] });
	}

	// ── 健康检查 ──
	private _registerHealthRoutes(app: express.Express): void {
		const container = this._container!;
		const healthRouter = express.Router();
		const runtimeConfigMiddleware = container.runtimeConfigService.middleware(container.router);
		healthRouter.get("/healthz", (_req, res) => {
			res.json({ status: "ok" });
		});
		healthRouter.head("/healthz", (_req, res) => {
			res.sendStatus(200);
		});
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
		proxyRouter.use(codingClientModelMiddleware(container.router));
		proxyRouter.use(container.authMiddleware);
		proxyRouter.use(webUiCsrfProtection);
		proxyRouter.use(container.authorizationGuard.middleware("inference"));
		proxyRouter.use(privacyMaskingMiddleware({ router: container.router, db: container.db.db }));
		proxyRouter.use(container.runtimeConfigService.middleware(container.router));
		proxyRouter.use((req, _res, next) =>
			container.router.runWithRequestRoutingParams({ metadata: req.body?.metadata, stream: req.body?.stream }, next),
		);
		proxyRouter.use(sseKeepaliveMiddleware(container.router));

		// Chat completions
		registerChatCompletionsRoutes(proxyRouter, container.router, container.db.db);
		// Embeddings
		registerEmbeddingsRoutes(proxyRouter, container.router, container.db.db);
		// Text completions
		registerCompletionsRoutes(proxyRouter, container.router, container.db.db);
		// Anthropic Messages
		registerAnthropicMessagesEndpoints(proxyRouter, container.router, undefined, container.db.db);
		// 订阅特殊端点（Responses compact / alpha search / 视频 / 语音 / live）；先于通用 Audio 注册
		registerSubscriptionSpecialRoutes(proxyRouter, container.router, container.db.db);
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
		// 管理端点的写请求会改动 key/team/user 等鉴权实体（含 key 删除、封禁、预算调整）。
		// 这些写入绕过 AuthRepository，直接在完成后清空进程内鉴权缓存，保证下一次鉴权
		// 读到新状态；读请求不触发，避免仪表盘轮询把缓存打空。
		managementRouter.use((req, res, next) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.once("finish", () => {
					if (res.statusCode < 400) {
						authRepositoryCache.clear();
					}
				});
			}
			next();
		});

		registerEntityPatchRoutes(managementRouter, container.db.db);
		createKeyManagementRoutes(managementRouter, container.db.db, container.authorizationGuard);
		createInternalUserRoutes(managementRouter, container.db.db, null);
		createTeamRoutes(managementRouter, container.db.db, null);
		createOrganizationRoutes(managementRouter, container.db.db, null);
		createCustomerRoutes(managementRouter, container.db.db, null);
		createModelManagementRoutes(managementRouter, container.db.db, null);
		registerCliProxyManagementRoutes(managementRouter, container.cliProxyRuntime);

		app.use(managementRouter);
		logger.info("管理端点已注册");
	}

	// ── 脱敏观测端点 ──
	private _registerPrivacyRoutes(app: express.Express, container: ServiceContainer): void {
		const privacyRouter = express.Router();
		privacyRouter.use(container.authMiddleware);
		privacyRouter.use(webUiCsrfProtection);
		privacyRouter.use(container.authorizationGuard.middleware("management"));
		registerPrivacyRoutes(privacyRouter, container.db.db);
		app.use(privacyRouter);
		logger.info("脱敏观测端点已注册");
	}

	// ── 内置 Provider 额度端点 ──
	private _registerProviderQuotaRoutes(app: express.Express, container: ServiceContainer): void {
		const providerQuotaRouter = express.Router();
		providerQuotaRouter.use(container.authMiddleware);
		providerQuotaRouter.use(webUiCsrfProtection);
		providerQuotaRouter.use(container.authorizationGuard.middleware("management"));
		providerQuotaRouter.use(container.runtimeConfigService.middleware(container.router));
		registerProviderQuotaRoutes(providerQuotaRouter, container.providerQuotaService, container.router);
		app.use(providerQuotaRouter);
		logger.info("内置 Provider 额度端点已注册");
	}

	// ── 消费端点 ──
	private _registerSpendRoutes(app: express.Express, container: ServiceContainer): void {
		const spendRouter = express.Router();
		spendRouter.use(container.authMiddleware);
		spendRouter.use(webUiCsrfProtection);
		spendRouter.use(container.authorizationGuard.middleware("spend"));
		spendRouter.use(spendResponseCompression);
		registerSpendManagementEndpoints(spendRouter, container.db.db);
		app.use(spendRouter);
		logger.info("消费端点已注册");
	}

	// ── 兼容端点（WebUI 支撑与保留 API 表面） ──
	private _registerStubRoutes(app: express.Express, container: ServiceContainer): void {
		const stubRouter = express.Router();
		stubRouter.use(codingClientModelMiddleware(container.router));
		stubRouter.use(container.authMiddleware);
		stubRouter.use(webUiCsrfProtection);
		stubRouter.use(container.authorizationGuard.middleware("authenticated"));
		stubRouter.use(privacyMaskingMiddleware({ router: container.router, db: container.db.db }));
		stubRouter.use(container.runtimeConfigService.middleware(container.router));
		stubRouter.use((req, _res, next) =>
			container.router.runWithRequestRoutingParams({ metadata: req.body?.metadata, stream: req.body?.stream }, next),
		);
		stubRouter.use(sseKeepaliveMiddleware(container.router));

		// Models 页面支撑（需鉴权）
		// 必须传 container.router：Router deployments 是运行时真实模型源，
		// 包含 config 重构过程中可能丢失的 model_info 字段与默认 deployment 元信息
		// （如 custom_llm_provider、rpm/tpm、timeout 等）。如果只传 config.modelList，
		// /v2/model/info 与 /model_group/info 拿不到 id / mode / cost 等关键字段。
		registerModelsPageSupportRoutes(stubRouter, container.router, this._config, container.modelCostMapService);

		// WebUI 鉴权支撑端点（/get/ui_settings、/config/list、/config/update、/team/list 等）
		registerWebUiSupportRoutes(stubRouter, this._config, container.db.db, container.router, container.credentialService);

		// Cost Tracking：折扣/保证金配置读写与费用估算（价格口径与 /model_group/info 一致）
		registerCostTrackingRoutes(stubRouter, container.db.db, container.router);

		registerResponsesApiRoutes(stubRouter, container.router, container.db.db);
		registerSearchToolsRoutes(stubRouter, container.db.db);
		registerCredentialRoutes(stubRouter, container.credentialService, container.router);
		registerUtilRoutes(stubRouter);

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
