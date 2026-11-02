import { AsyncLocalStorage } from "node:async_hooks";
import type { UpstreamLogContext } from "./UpstreamLogContext";

/**
 * 请求作用域内的上游交换旁路通道。
 *
 * 上游请求/响应详情是诊断数据，不参与客户端响应、计费或重试决策。历史实现把它挂在
 * 返回值对象的不可枚举 Symbol 上，任何重建结果对象的中间层（能力循环累积、
 * 对象展开、Object.fromEntries）都会静默丢掉它，SpendLog 于是只剩 下游 请求。
 *
 * 现在改为按请求作用域记录：传输层写入最近一次真实上游交换，日志层读取它。
 * 业务结果对象不再承载诊断状态，中间层怎么复制都不会影响观测。
 */
interface UpstreamExchangeChannel {
	/** 当前作用域最近一次真实上游交换。 */
	latest?: UpstreamLogContext;
}

const channels = new AsyncLocalStorage<UpstreamExchangeChannel>();

/**
 * 在独立的上游交换作用域内执行。
 *
 * 用于两类边界：每个 HTTP 请求一个作用域（由 `upstreamExchangeScope` 中间件建立），
 * 以及内置能力的 worker 调用一个子作用域，避免内部调用覆盖外层请求记录的上游交换。
 * @template T - 回调返回类型
 * @param callback - 在该作用域内执行的逻辑
 */
export function runWithUpstreamExchangeScope<T>(callback: () => T): T {
	return channels.run({}, callback);
}

/**
 * 记录一次真实上游交换；没有作用域时静默忽略（后台任务、单元测试）。
 * @param context - 传输层构造的上游请求/响应上下文
 */
export function recordUpstreamExchange(context: UpstreamLogContext): void {
	const channel = channels.getStore();
	if (channel !== undefined) {
		channel.latest = context;
	}
}

/**
 * 读取当前作用域最近一次真实上游交换。
 * @returns 尚未发起上游调用时返回 undefined
 */
export function getRecordedUpstreamExchange(): UpstreamLogContext | undefined {
	return channels.getStore()?.latest;
}

/**
 * 在独立子作用域内执行一次内部能力调用，并在结束后取回它产生的上游交换。
 *
 * worker 调用属于当前请求内部的旁路调用：它必须记录到自己那行审计日志，
 * 但不能覆盖外层请求的上游交换，因此用子作用域隔离。
 * @template T - 内部调用返回类型
 * @param callback - 发起内部上游调用的逻辑
 */
export async function captureUpstreamExchange<T>(
	callback: () => Promise<T>,
): Promise<{ result: T; context: UpstreamLogContext | undefined }> {
	return channels.run({}, async () => {
		const channel = channels.getStore();
		const result = await callback();
		return { result: result, context: channel?.latest };
	});
}
