/**
 * Health 端点 — 健康检查、就绪性、存活性和服务状态
 *
 * 存活、就绪与服务状态端点免认证；主动 Provider 探测及 latest snapshot 需要鉴权。
 * 对应 LiteLLM Python 的 /health, /health/readiness, /health/liveliness 等路由。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 */

import { get, noAuth, query } from "../core/api/decorators";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { DeploymentNotFoundError, type DeploymentProbeResult, type Router } from "../router/Router";

/**
 * /health 响应结构（对齐 Python health_endpoints.py health_endpoint 返回）。
 * TS 端暂无主动健康检查执行器，无检查结果时返回空列表 + 0 计数，
 * 保持与 Python 相同的顶层结构。
 */
interface HealthCheckResponse {
	/** 健康（通过检查）的 deployment 脱敏摘要 */
	healthy_endpoints: DeploymentProbeResult[];
	/** 不健康（检查失败）的 deployment 脱敏摘要 */
	unhealthy_endpoints: DeploymentProbeResult[];
	/** 健康 deployment 数 */
	healthy_count: number;
	/** 不健康 deployment 数 */
	unhealthy_count: number;
}

/**
 * /health/services 可检查的服务名（对齐 Python health_services_endpoint 运行时白名单，
 * litellm/proxy/health_endpoints/_health_endpoints.py:220-238）
 */
const HEALTH_CHECKABLE_SERVICES: readonly string[] = [
	"slack_budget_alerts",
	"email",
	"langfuse",
	"langfuse_otel",
	"slack",
	"openmeter",
	"webhook",
	"braintrust",
	"otel",
	"custom_callback_api",
	"langsmith",
	"datadog",
	"datadog_metrics",
	"datadog_llm_observability",
	"generic_api",
	"arize",
	"sqs",
];

/**
 * Python `services` 类型注解的 repr（health_endpoints.py 中
 * `services = Union[Literal[...], str]`），用于复刻非法 service 的报错文本。
 * 注意：Literal 列表是 13 项类型注解，比运行时白名单（17 项）短。
 */
const SERVICES_TYPE_REPR =
	"typing.Union[typing.Literal['slack_budget_alerts', 'langfuse', 'langfuse_otel', 'slack', 'openmeter', 'webhook', 'email', 'braintrust', 'datadog', 'datadog_llm_observability', 'generic_api', 'arize', 'sqs'], str]";

/** Readiness response compatible with Python LiteLLM. */
interface ReadinessResponse {
	/** Overall worker status. */
	status: string;
	/** Database connectivity status. */
	db: string;
	/** Cache backend status or metadata. */
	cache: null | string | Record<string, unknown>;
	/** LiteLLM TS proxy version string. */
	litellm_version: string;
	/** Configured success callbacks. */
	success_callbacks: string[];
	/** Python field retained for WebUI compatibility. */
	use_aiohttp_transport: boolean;
	/** Effective logger level. */
	log_level: string;
	/** Whether verbose debug logging is enabled. */
	is_detailed_debug: boolean;
}

/** Latest health check response compatible with Python LiteLLM. */
interface LatestHealthChecksResponse {
	/** Latest health checks keyed by model id/name. */
	latest_health_checks: Record<string, HealthCheckEntry>;
	/** Number of models with recorded health checks. */
	total_models: number;
}

/**
 * 单个模型的健康检查状态
 * - HEALTHY: 最近一次健康检查通过
 * - UNHEALTHY: 最近一次健康检查失败
 * - UNKNOWN: 尚未执行过健康检查或健康检查组件未启用
 */
enum HealthCheckStatus {
	HEALTHY = "healthy",
	UNHEALTHY = "unhealthy",
	UNKNOWN = "unknown",
}

/**
 * 健康检查控制器
 *
 * 提供 Kubernetes liveness/readiness probe 与鉴权后的主动 Provider 探测。
 */
export class HealthController {
	private static readonly _probeConcurrency = 5;
	private readonly _latestHealthChecks = new Map<string, HealthCheckEntry>();

	constructor(private readonly _router?: Router) {}

	/**
	 * 全量健康检查 — 返回各 deployment 的健康/不健康清单与计数
	 *
	 * 对齐 Python health_endpoint 的顶层响应结构
	 * （litellm/proxy/health_endpoints/_health_endpoints.py:808）。
	 * TS 端暂无主动健康检查执行器，未执行检查时返回空列表与 0 计数。
	 * 保持 @noAuth：容器 HEALTHCHECK 探针依赖本端点 200 响应。
	 * @param modelId
	 * @returns 健康检查结果汇总
	 */
	@get("/health")
	async healthCheck(@query("model_id") modelId?: string): Promise<HealthCheckResponse> {
		if (this._router === undefined) {
			return { healthy_endpoints: [], unhealthy_endpoints: [], healthy_count: 0, unhealthy_count: 0 };
		}

		let results: DeploymentProbeResult[];
		try {
			if (modelId !== undefined && modelId.length > 0) {
				results = [await this._router.probeDeployment(modelId)];
			} else {
				const modelIds = this._router
					.getDeployments()
					.map((deployment) => deployment.model_info?.id)
					.filter((id): id is string => typeof id === "string" && id.length > 0);
				results = [];
				for (let index = 0; index < modelIds.length; index += HealthController._probeConcurrency) {
					const batch = modelIds.slice(index, index + HealthController._probeConcurrency);
					results.push(...(await Promise.all(batch.map((id) => this._router!.probeDeployment(id)))));
				}
			}
		} catch (error) {
			if (error instanceof DeploymentNotFoundError) {
				throw ApiError.notFound(error.message);
			}
			throw error;
		}

		for (const result of results) {
			this._latestHealthChecks.set(result.model_id, {
				model_name: result.model_name,
				status: result.status === "healthy" ? HealthCheckStatus.HEALTHY : HealthCheckStatus.UNHEALTHY,
				checked_at: result.checked_at,
				latency_ms: result.latency_ms,
				error_message: result.error,
			});
		}
		const healthyEndpoints = results.filter((result) => result.status === "healthy");
		const unhealthyEndpoints = results.filter((result) => result.status === "unhealthy");
		return {
			healthy_endpoints: healthyEndpoints,
			unhealthy_endpoints: unhealthyEndpoints,
			healthy_count: healthyEndpoints.length,
			unhealthy_count: unhealthyEndpoints.length,
		};
	}

	/**
	 * 就绪性检查 — 服务是否准备好接收流量
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health/readiness")
	async readiness(): Promise<ReadinessResponse> {
		return {
			status: "healthy",
			db: "Not connected",
			cache: null,
			litellm_version: process.env.npm_package_version ?? "unknown",
			success_callbacks: [],
			use_aiohttp_transport: false,
			log_level: process.env.LOG_LEVEL ?? "info",
			is_detailed_debug: process.env.LOG_LEVEL === "debug",
		};
	}

	/**
	 * 存活检查 — K8s liveness probe
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health/liveliness")
	async liveliness(): Promise<string> {
		return "I'm alive!";
	}

	/**
	 * 存活检查（正确拼写） — K8s liveness probe
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health/liveness")
	async liveness(): Promise<string> {
		return "I'm alive!";
	}

	/**
	 * 服务状态 — 检查指定集成服务（slack/datadog/langfuse 等）是否可用
	 *
	 * 对齐 Python health_services_endpoint 的参数校验语义
	 * （litellm/proxy/health_endpoints/_health_endpoints.py:190-244）：
	 * - 缺 service 查询参数 → 422 FastAPI 风格 { detail: [{ loc, msg, type }] }
	 * - service 不在白名单 → 400 Python ProxyException 风格错误
	 * TS 端未接入真实集成，合法 service 返回与 Python 通用分支相同的
	 * { status, message } 形状。
	 * @param service - 待检查的服务名（必填查询参数）
	 * @returns 服务检查结果
	 */
	@noAuth()
	@get("/health/services")
	async services(@query("service") service?: string): Promise<{ status: string; message: string }> {
		if (service === undefined) {
			throw ApiError.unprocessableEntity([{ loc: ["query", "service"], msg: "Field required", type: "missing" }]);
		}
		if (!HEALTH_CHECKABLE_SERVICES.includes(service)) {
			// Python 实测响应：HTTP 400 + { error: { message: str(detail_dict), type: "auth_error", param: "None", code: "400" } }
			throw new ApiError(
				HTTP_STATUS.BAD_REQUEST,
				`{'error': "Service must be in list. Service=${service} not in ${SERVICES_TYPE_REPR}"}`,
				"auth_error",
				"None",
			);
		}
		// 对齐 Python 通用分支（openmeter/braintrust/generic_api 等）的响应形状
		return {
			status: "success",
			message: `Mock LLM request made - check ${service}.`,
		};
	}

	/**
	 * 最新健康检查结果 — 返回所有模型的最近一次健康检查状态
	 *
	 * WebUI Models 页面使用此端点展示各部署的健康状态。
	 * 与其它 health 端点一致：免认证（@noAuth），便于 K8s probe 复用。
	 * @returns 各模型的健康检查结果映射
	 */
	@get("/health/latest")
	async latestHealth(): Promise<LatestHealthChecksResponse> {
		return {
			latest_health_checks: Object.fromEntries(this._latestHealthChecks),
			total_models: this._latestHealthChecks.size,
		};
	}
}

/** 单个模型的健康检查记录 */
interface HealthCheckEntry {
	/** 模型名称 */
	model_name: string;
	/** 健康状态 */
	status: HealthCheckStatus;
	/** 检查时间戳 */
	checked_at: string;
	/** 响应延迟（毫秒） */
	latency_ms?: number;
	/** 错误信息 */
	error_message?: string;
}
