import { redactErrorPayload } from "../core/api/redactConfiguredSecrets";
import type { ProviderRequest } from "../types/provider";
import type { Deployment } from "../types/router";
import { buildDeploymentSpendInfo, type DeploymentSpendInfo } from "./RouterSpendInfo";
import { getRecordedUpstreamExchange, recordUpstreamExchange } from "./UpstreamExchange";

/** 可写入详细 SpendLog 的上游请求。 */
export interface UpstreamRequestLog {
	/** 最终请求 URL。 */
	readonly url: string;
	/** HTTP 方法。 */
	readonly method: string;
	/** 请求头（原样记录）。 */
	readonly headers: Record<string, string>;
	/** Provider 转换后的 JSON 请求体。 */
	readonly body: unknown;
}

/** 可写入详细 SpendLog 的上游响应。 */
export interface UpstreamResponseLog {
	/** 上游 HTTP 状态码。 */
	readonly status_code: number;
	/** 响应头（原样记录）。 */
	readonly headers: Record<string, string>;
	/** 已解析的非流式响应体，或流式协议终态事件携带的完整响应对象。 */
	readonly body?: unknown;
}

/** 单次最终 Provider 调用的请求/响应上下文。 */
export interface UpstreamLogContext {
	/** Actual deployment of this exchange, including failed calls. Never serialized with request payloads. */
	readonly spendInfo?: DeploymentSpendInfo;
	/** 实际上游请求。 */
	readonly request: UpstreamRequestLog;
	/** 实际上游响应；网络层失败时可能不存在。 */
	readonly response?: UpstreamResponseLog;
}

const UPSTREAM_LOG_CONTEXT = Symbol("litellm.upstreamLogContext");

function collectHeaders(headers: Headers | Record<string, string> | undefined): Record<string, string> {
	const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers ?? {});
	return Object.fromEntries(entries);
}

/**
 * 从 Provider transport 的真实请求/响应构造可持久化的诊断上下文。
 *
 * 构造即记录：该上下文同时写入当前请求作用域的上游交换通道，因此调用方不需要
 * （也不应该）把它挂在业务返回值上再逐层搬运。
 * @param request - Provider 转换后的最终请求
 * @param response - 上游 HTTP 响应
 * @param responseBody - 已解析的非流式上游响应体
 * @param deployment - Actual deployment that sent this request
 */
export function createUpstreamLogContext(
	request: ProviderRequest,
	response?: Response,
	responseBody?: unknown,
	deployment?: Deployment,
): UpstreamLogContext {
	const context: UpstreamLogContext = {
		...(deployment ? { spendInfo: buildDeploymentSpendInfo(deployment, request.url) } : {}),
		request: {
			url: request.url,
			method: request.method,
			headers: collectHeaders(request.headers),
			body: request.logBody ?? request.body,
		},
		...(response
			? {
					response: {
						status_code: response.status,
						headers: collectHeaders(response.headers),
						...(responseBody !== undefined
							? { body: response.status >= 400 ? redactErrorPayload(responseBody, request.headers) : responseBody }
							: {}),
					},
				}
			: {}),
	};
	recordUpstreamExchange(context);
	return context;
}

/**
 * 以不可枚举 Symbol 挂载诊断上下文，仅供单个对象内的即时读取。
 *
 * 主通道是请求作用域的上游交换通道（`UpstreamExchange`）：任何重建结果对象的中间层
 * 都会丢掉这里的 Symbol，所以不要把跨层的观测数据只放在这里。
 * @template T - 挂载上下文的对象类型
 * @param target - Router 结果或异常对象
 * @param context - 上游请求/响应上下文
 */
export function attachUpstreamLogContext<T extends object>(target: T, context: UpstreamLogContext | undefined): T {
	if (!context) {
		return target;
	}
	Object.defineProperty(target, UPSTREAM_LOG_CONTEXT, {
		value: context,
		configurable: true,
		enumerable: false,
		writable: true,
	});
	return target;
}

/**
 * 读取上游诊断上下文：优先取当前请求作用域记录的真实交换，再退回对象上的挂载值。
 * @param value - Router 结果或异常对象（仅作为无作用域时的兜底来源）
 */
export function getUpstreamLogContext(value: unknown): UpstreamLogContext | undefined {
	const recorded = getRecordedUpstreamExchange();
	if (recorded !== undefined) {
		return recorded;
	}
	return getAttachedUpstreamLogContext(value);
}

/**
 * 只读取对象自身挂载的上游上下文，不回退到请求级通道。
 *
 * 用于「一次内部调用一行审计日志」的场景：那里必须使用该调用自己的上游交换，
 * 不能借用外层请求通道里记录的主请求交换。
 * @param value - 该次内部调用的结果或异常对象
 */
export function getAttachedUpstreamLogContext(value: unknown): UpstreamLogContext | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	return (value as { [UPSTREAM_LOG_CONTEXT]?: UpstreamLogContext })[UPSTREAM_LOG_CONTEXT];
}
