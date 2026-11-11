/**
 * 订阅执行桥的注册点。
 *
 * Router 的 transport 层不能反向依赖订阅运行时（运行时本身会调用
 * executeProviderRequest 完成真实上游请求），因此通过一个进程内回调解耦。
 */

import type { ProviderRequest } from "../types/provider";
import type { ProviderRequestExecutionOptions, ProviderRequestExecutionResult } from "./ProviderRequestExecutor";

/** 订阅请求处理器。 */
export type SubscriptionRequestHandler = (
	request: ProviderRequest,
	options: ProviderRequestExecutionOptions,
) => Promise<ProviderRequestExecutionResult>;

let handler: SubscriptionRequestHandler | undefined;

/**
 * 注册/替换订阅请求处理器。
 * @param next - 处理器；undefined 表示关闭
 */
export function setSubscriptionRequestHandler(next: SubscriptionRequestHandler | undefined): void {
	handler = next;
}

/**
 * 取当前处理器。
 */
export function getSubscriptionRequestHandler(): SubscriptionRequestHandler | undefined {
	return handler;
}
