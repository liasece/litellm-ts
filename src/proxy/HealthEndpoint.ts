/**
 * Health 端点 — 健康检查、就绪性、存活性和服务状态
 *
 * 所有端点均免认证（@noAuth），用于容器编排和服务发现。
 * 对应 LiteLLM Python 的 /health, /health/readiness, /health/liveliness 等路由。
 */

import { get, noAuth } from "../core/api/decorators";

/** 健康检查响应 */
interface HealthResponse {
	/** 服务状态 */
	status: string;
	/** 服务标识 */
	service?: string;
	/** 额外信息 */
	detail?: string;
	/** 服务列表（服务状态页） */
	services?: Record<string, string>;
}

/**
 * 健康检查控制器
 *
 * 提供 Kubernetes liveness/readiness probe 和扩缩容感知。
 * 所有路由允许未认证访问，不记录访问日志。
 */
export class HealthController {
	/**
	 * 基础健康检查 — 返回服务是否存活
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health")
	async healthCheck(): Promise<HealthResponse> {
		return { status: "ok" };
	}

	/**
	 * 就绪性检查 — 服务是否准备好接收流量
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health/readiness")
	async readiness(): Promise<HealthResponse> {
		return { status: "ready" };
	}

	/**
	 * 存活检查 — K8s liveness probe
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health/liveliness")
	async liveliness(): Promise<HealthResponse> {
		return { status: "alive" };
	}

	/**
	 * 存活检查（正确拼写） — K8s liveness probe
	 * @returns 健康状态对象
	 */
	@noAuth()
	@get("/health/liveness")
	async liveness(): Promise<HealthResponse> {
		return { status: "alive" };
	}

	/**
	 * 服务状态 — 返回各依赖服务的运行状况
	 * @returns 服务状态映射
	 */
	@noAuth()
	@get("/health/services")
	async services(): Promise<HealthResponse> {
		return {
			status: "ok",
			service: "litellm-ts",
			detail: "LiteLLM TypeScript Gateway — 核心代理端点运行正常",
			services: {
				server: "running",
			},
		};
	}
}
