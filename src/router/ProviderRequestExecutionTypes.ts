/**
 * Provider 请求执行的参数与结果形状。
 *
 * 从 `ProviderRequestExecutor.ts` 抽出：`SubscriptionDispatch.ts` 只拿这两个类型做回调签名，
 * 而执行器要反过来 import 订阅分发的注册表。类型放到叶子上，值依赖保持单向。
 */

/** Provider 请求执行选项。 */
export interface ProviderRequestExecutionOptions {
	/** 请求超时（毫秒）；缺省时不设置定时中止。 */
	readonly timeoutMs?: number;
	/** 是否读取 JSON 响应体；false 时成功流保持未读，但非 2xx 响应仍读取错误体。 */
	readonly readJson?: boolean;
	/** 调用方取消信号；与 provider timeout 任一触发都会中止上游请求。 */
	readonly signal?: AbortSignal;
}

/** Provider 请求执行结果。 */
export interface ProviderRequestExecutionResult {
	/**
	 *
	 */
	readonly response: Response;
	/**
	 *
	 */
	readonly body?: unknown;
	/**
	 *
	 */
	readonly latencyMs: number;
	/**
	 *
	 */
	readonly startedAtMs: number;
}
