import { AsyncLocalStorage } from "node:async_hooks";
import { createModelResolutionTraceCollector, type ModelResolutionTraceCollector } from "./ModelResolutionTrace";
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
/** 上游交换的只读观察者；在传输层记录后同步调用，异常不影响请求。 */
export type UpstreamExchangeObserver = (context: UpstreamLogContext) => void;

interface UpstreamExchangeChannel {
	/** 当前作用域最近一次真实上游交换。 */
	latest?: UpstreamLogContext;
	/** 请求级观察者，用于把已确定的上游信息补写进在途日志。 */
	observer?: UpstreamExchangeObserver;
	/** 请求级路由解析轨迹，供观察者读取当前进度。 */
	resolutionTrace?: ModelResolutionTraceCollector;
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
	if (channel === undefined) {
		return;
	}
	channel.latest = context;
	const observer = channel.observer;
	if (observer === undefined) {
		return;
	}
	try {
		observer(context);
	} catch {
		// 观察者只做旁路记录，任何异常都不能影响真实上游调用与客户端响应。
	}
}

/**
 * 注册当前请求作用域的上游交换观察者。
 *
 * 传输层在每次记录真实上游交换后同步调用它，调用方据此把已经确定的上游请求/响应
 * 补写进在途日志。子作用域（内置能力调用）不会继承观察者，内部调用的上游交换
 * 仍只归它自己的审计日志。
 * @param observer - 收到上游交换后执行的旁路逻辑
 * @returns 当前不在请求作用域内时返回 false
 */
export function observeUpstreamExchange(observer: UpstreamExchangeObserver): boolean {
	const channel = channels.getStore();
	if (channel === undefined) {
		return false;
	}
	channel.observer = observer;
	return true;
}

/**
 * 记录当前请求的路由解析轨迹，供上游交换观察者读取最新进度。
 * @param collector - endpoint 持有的请求级可变轨迹容器
 */
export function publishModelResolutionTrace(collector: ModelResolutionTraceCollector): void {
	const channel = channels.getStore();
	if (channel !== undefined) {
		channel.resolutionTrace = collector;
	}
}

/**
 * 读取当前请求已发布的路由解析轨迹。
 * @returns 尚未开始路由解析时返回 undefined
 */
export function getRecordedModelResolutionTrace(): ModelResolutionTraceCollector | undefined {
	return channels.getStore()?.resolutionTrace;
}

/**
 * 创建请求级路由解析轨迹并立即发布到当前请求作用域。
 *
 * `Router._executeWithFallback` 会在每次尝试前发布自己持有的轨迹，但 endpoint 自己的
 * fallback 循环（流式 chat、/v1/messages、embeddings）不经过它：只创建不发布的轨迹会让
 * 上游交换观察者读不到进度，在途日志因此缺 `fallback_models` / `routing_trace`，
 * 列表里的 fallback 计数要等落账后才出现。endpoint 建立请求作用域时统一用它，
 * 之后对同一容器的追加会被观察者同步看到。
 * @returns 已发布（无请求作用域时仅创建）的轨迹容器
 */
export function createPublishedModelResolutionTrace(): ModelResolutionTraceCollector {
	const collector = createModelResolutionTraceCollector();
	publishModelResolutionTrace(collector);
	return collector;
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
