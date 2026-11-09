/**
 * 请求级耗时轨迹。
 *
 * 关键取舍：观测必须在任意嵌套的异步边界上都能拿到「当前请求」的上下文，否则
 * 传输层、路由层、记账层各自只能看到局部耗时，拼不出真实时间轴。这里沿用仓库
 * 已有的 AsyncLocalStorage 用法（见 router/UpstreamExchange.ts），由 HTTP 层建立
 * 作用域，其余层只写标记，不改变任何函数签名。
 *
 * 轨迹本身只保存少量数字与最近几次上游尝试，不保存请求体、响应体、Header 或密钥，
 * 因此可以安全地进入日志与报表。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

/** 时间轴标记点；同一标记只记录第一次，避免重试路径覆盖首次到达时间。 */
export type TraceMark =
	| "request_start"
	| "body_parsed"
	| "auth_done"
	| "upstream_start"
	| "upstream_headers"
	| "upstream_body"
	| "upstream_first_chunk"
	| "first_client_byte"
	| "first_payload_byte"
	| "response_end"
	| "spend_written";

/** 一次上游尝试的结果。 */
export type UpstreamAttemptOutcome = "pending" | "ok" | "error";

/** 一次上游交换的关键时刻；只保留定位性能所需的时间戳与状态。 */
export interface UpstreamAttemptRecord {
	/** 上游主机（含端口），用于按 Provider 归类 */
	readonly host: string;
	/** 尝试开始时间（单调时钟毫秒） */
	readonly startedAt: number;
	/** 收到响应头的时间 */
	headersAt?: number;
	/** 响应体读完/首个流式块到达的时间 */
	firstPayloadAt?: number;
	/** HTTP 状态码 */
	statusCode?: number;
	/** 尝试结束时刻（响应体读完或判定失败） */
	endedAt?: number;
	/** 结果 */
	outcome: UpstreamAttemptOutcome;
}

/** 请求轨迹的可变状态；只在请求作用域内被写入。 */
export interface RequestTraceState {
	/** 轨迹 ID，用于把日志行与慢请求列表关联 */
	readonly id: string;
	/** HTTP 方法 */
	readonly method: string;
	/** 单调时钟起点（毫秒） */
	readonly startedAt: number;
	/** 墙钟起点（毫秒时间戳） */
	readonly startedAtWallMs: number;
	/** 归一化路由类别 */
	route: string;
	/** 客户端请求的模型名（alias 或模型组），未解析时为空 */
	requestedModel?: string;
	/** 是否流式请求 */
	stream: boolean;
	/** HTTP 状态码 */
	statusCode?: number;
	/** 客户端是否提前断开 */
	aborted: boolean;
	/** 标记点 */
	readonly marks: Partial<Record<TraceMark, number>>;
	/** 上游尝试记录（最多保留最近 MAX_ATTEMPTS 条） */
	readonly attempts: UpstreamAttemptRecord[];
	/** 写回客户端的字节数 */
	bytesOut: number;
	/** 写回客户端的帧数 */
	chunksOut: number;
	/** 上游返回的输入 token 数（仅用于吞吐统计） */
	promptTokens?: number;
	/** 上游返回的输出 token 数（仅用于吞吐统计） */
	completionTokens?: number;
	/** 错误分类，仅用于告警维度 */
	errorKind?: string;
	/** 该请求在响应结束前累计的数据库往返次数（含鉴权、运行时配置、在途登记） */
	dbQueries: number;
	/** 其中失败的次数 */
	dbErrors: number;
}

/** 单次请求最多保留的上游尝试条数；重试风暴时只留最近几条。 */
const MAX_ATTEMPTS = 8;

interface TraceChannel {
	readonly trace: RequestTraceState;
}

const channels = new AsyncLocalStorage<TraceChannel>();

/**
 * 创建一条请求轨迹。
 * @param method - HTTP 方法
 * @param route - 归一化路由类别
 */
export function createRequestTrace(method: string, route: string): RequestTraceState {
	const now = performance.now();
	return {
		id: randomUUID(),
		method: method,
		startedAt: now,
		startedAtWallMs: Date.now(),
		route: route,
		stream: false,
		aborted: false,
		marks: { request_start: now },
		attempts: [],
		bytesOut: 0,
		chunksOut: 0,
		dbQueries: 0,
		dbErrors: 0,
	};
}

/**
 * 在轨迹作用域内执行回调。
 * @template T - 回调返回值类型
 * @param trace - 轨迹
 * @param callback - 回调
 */
export function runWithRequestTrace<T>(trace: RequestTraceState, callback: () => T): T {
	return channels.run({ trace: trace }, callback);
}

/**
 * 读取当前请求轨迹。
 * @returns 不在请求作用域内时返回 undefined
 */
export function currentRequestTrace(): RequestTraceState | undefined {
	return channels.getStore()?.trace;
}

/**
 * 记录一个时间标记；同一标记只保留首次。
 * @param mark - 标记名
 * @param at - 时间戳，默认当前单调时钟
 */
export function markTrace(mark: TraceMark, at: number = performance.now()): void {
	const trace = channels.getStore()?.trace;
	if (trace === undefined) {
		return;
	}
	if (trace.marks[mark] === undefined) {
		trace.marks[mark] = at;
	}
}

/**
 * 直接取某个标记。
 * @param trace - 轨迹
 * @param mark - 标记名
 */
export function traceMarkAt(trace: RequestTraceState, mark: TraceMark): number | undefined {
	return trace.marks[mark];
}

/**
 * 开始一次上游尝试并登记到轨迹。
 * @param url - 上游请求地址（只取主机部分）
 * @returns 可继续补齐时刻的尝试记录；无作用域时返回 undefined
 */
export function beginUpstreamAttempt(url: string): UpstreamAttemptRecord | undefined {
	const trace = channels.getStore()?.trace;
	if (trace === undefined) {
		return undefined;
	}
	const attempt: UpstreamAttemptRecord = {
		host: hostOf(url),
		startedAt: performance.now(),
		outcome: "pending",
	};
	trace.attempts.push(attempt);
	if (trace.attempts.length > MAX_ATTEMPTS) {
		trace.attempts.splice(0, trace.attempts.length - MAX_ATTEMPTS);
	}
	markTrace("upstream_start", attempt.startedAt);
	return attempt;
}

/**
 * 补齐一次上游尝试的响应头时刻与状态。
 * @param attempt - beginUpstreamAttempt 的返回值
 * @param statusCode - HTTP 状态码
 * @param at - 时刻
 */
export function noteUpstreamHeaders(
	attempt: UpstreamAttemptRecord | undefined,
	statusCode: number,
	at: number = performance.now(),
): void {
	if (attempt === undefined) {
		return;
	}
	attempt.headersAt ??= at;
	attempt.statusCode = statusCode;
	markTrace("upstream_headers", at);
}

/**
 * 补齐一次上游尝试的首个响应内容时刻。
 * @param attempt - beginUpstreamAttempt 的返回值
 * @param at - 时刻
 */
export function noteUpstreamPayload(attempt: UpstreamAttemptRecord | undefined, at: number = performance.now()): void {
	if (attempt === undefined) {
		return;
	}
	attempt.firstPayloadAt ??= at;
}

/**
 * 结束一次上游尝试并记录结果。
 * @param attempt - beginUpstreamAttempt 的返回值
 * @param outcome - 结果
 * @param at - 时刻
 */
export function endUpstreamAttempt(
	attempt: UpstreamAttemptRecord | undefined,
	outcome: Exclude<UpstreamAttemptOutcome, "pending">,
	at: number = performance.now(),
): void {
	if (attempt === undefined) {
		return;
	}
	attempt.outcome = outcome;
	attempt.endedAt ??= at;
}

/**
 * 记录上游流式首块到达时刻；由流包装器在第一次 yield 时调用。
 */
export function noteUpstreamFirstChunk(): void {
	const trace = channels.getStore()?.trace;
	const attempt = trace?.attempts[trace.attempts.length - 1];
	if (attempt === undefined) {
		return;
	}
	// 首块与「响应体读完」是两件事：流式请求永远读不完，只能靠这里记录上游开始产出的时刻。
	markTrace("upstream_first_chunk", performance.now());
}

/**
 * 记录客户端首个字节写出时刻。
 * @param at - 时刻
 */
export function noteFirstClientByte(at: number = performance.now()): void {
	markTrace("first_client_byte", at);
}

/**
 * 记录首个「内容」字节写出的时刻。
 *
 * 流式协议会在模型输出前先发心跳、ping 或填充帧（`/responses` 会先发 4KB padding），
 * 这些字节到达客户端不代表模型开始了。首字指标必须用内容字节，否则会把协议前言
 * 当成生成速度。
 * @param at - 时刻（单调时钟毫秒）
 */
export function noteFirstPayloadByte(at: number = performance.now()): void {
	markTrace("first_payload_byte", at);
}

/**
 * 记录响应结束时刻与状态。
 * @param statusCode - HTTP 状态码
 * @param aborted - 客户端是否提前断开
 */
export function noteResponseEnd(statusCode: number, aborted: boolean): void {
	const trace = channels.getStore()?.trace;
	if (trace === undefined) {
		return;
	}
	trace.statusCode = statusCode;
	trace.aborted = aborted;
	markTrace("response_end");
}

/**
 * 补充模型与用量等请求属性。
 * @param patch - 待补充字段
 */
export function annotateRequestTrace(patch: {
	readonly route?: string;
	readonly requestedModel?: string;
	readonly stream?: boolean;
	readonly promptTokens?: number;
	readonly completionTokens?: number;
	readonly errorKind?: string;
}): void {
	const trace = channels.getStore()?.trace;
	if (trace === undefined) {
		return;
	}
	if (patch.route !== undefined) {
		trace.route = patch.route;
	}
	if (patch.requestedModel !== undefined) {
		trace.requestedModel = patch.requestedModel;
	}
	if (patch.stream !== undefined) {
		trace.stream = patch.stream;
	}
	if (patch.promptTokens !== undefined) {
		trace.promptTokens = patch.promptTokens;
	}
	if (patch.completionTokens !== undefined) {
		trace.completionTokens = patch.completionTokens;
	}
	if (patch.errorKind !== undefined) {
		trace.errorKind = patch.errorKind;
	}
}

/**
 * 取上游地址的主机部分，作为 Provider 维度标签。
 * @param url - 上游地址
 */
function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "invalid";
	}
}

/** 请求耗时分解结果，全部为毫秒；无法测量的阶段为 undefined。 */
export interface RequestTimingBreakdown {
	/** 请求总耗时：到达 → 响应结束 */
	readonly totalMs: number;
	/** 请求体解析耗时 */
	readonly bodyParseMs?: number;
	/** 鉴权耗时 */
	readonly authMs?: number;
	/** 首个上游请求发出前的本地耗时（解析 + 鉴权 + 路由） */
	readonly preUpstreamMs?: number;
	/** 上游等待响应头耗时（连接 + 排队 + 上游首包） */
	readonly upstreamHeadersMs?: number;
	/** 上游首个响应内容耗时 */
	readonly upstreamPayloadMs?: number;
	/** 客户端传输首字节耗时（可能只是心跳/填充帧） */
	readonly firstByteMs?: number;
	/** 首字耗时（TTFB）：请求到达 → 上游开始输出（非流式则为响应体读完） */
	readonly ttfbMs?: number;
	/** 从上游首个内容到客户端首字节之间的转换开销 */
	readonly proxyOverheadMs?: number;
	/** 首字节到响应结束的流式传输时长 */
	readonly streamMs?: number;
	/** 响应结束后补记耗时（记账落库等） */
	readonly postResponseMs?: number;
}

/**
 * 按时间轴标记计算分解耗时。
 * @param trace - 轨迹
 * @param endAt - 响应结束时刻，缺省取标记
 */
export function computeTimingBreakdown(trace: RequestTraceState, endAt?: number): RequestTimingBreakdown {
	const end = endAt ?? trace.marks.response_end ?? performance.now();
	const firstAttempt = trace.attempts[0];
	const lastAttempt = trace.attempts[trace.attempts.length - 1];
	// 流式请求以首块为上界；非流式以响应体读完为上界。二者不能混用，否则流式会把
	// 「等首包」算成「代理开销」。
	const upstreamPayloadAt = trace.marks.upstream_first_chunk ?? lastAttempt?.firstPayloadAt;
	const responseEnd = trace.marks.response_end;
	// 内容字节优先：协议前言（心跳/ping/填充）不计入客户端首内容。
	const firstContentAt = trace.marks.first_payload_byte ?? trace.marks.first_client_byte;
	// 首字以模型开始产出为准。客户端可能先收到本地合成的 SSE 前言（例如
	// `response.created`）或 4KB 填充帧，这些字节早于上游首块，不能当模型延迟。
	const modelStartAt = upstreamPayloadAt ?? firstContentAt;
	// 生成阶段从「模型开始 + 客户端开始」中较晚的那个时刻算起，避免把等待算进流时长。
	const streamStartAt =
		upstreamPayloadAt !== undefined && firstContentAt !== undefined
			? Math.max(upstreamPayloadAt, firstContentAt)
			: (upstreamPayloadAt ?? firstContentAt);
	return {
		totalMs: round1(end - trace.startedAt),
		bodyParseMs: diff1(trace.marks.body_parsed, trace.startedAt),
		authMs: diff1(trace.marks.auth_done, trace.marks.body_parsed ?? trace.startedAt),
		preUpstreamMs: diff1(firstAttempt?.startedAt, trace.startedAt),
		upstreamHeadersMs: diff1(firstAttempt?.headersAt, firstAttempt?.startedAt),
		upstreamPayloadMs: diff1(lastAttempt?.firstPayloadAt, lastAttempt?.headersAt),
		firstByteMs: diff1(trace.marks.first_client_byte, trace.startedAt),
		ttfbMs: diff1(modelStartAt, trace.startedAt),
		// 只有客户端确实晚于上游时才谈代理开销；前言早于上游时差值为负，没有意义。
		proxyOverheadMs:
			firstContentAt !== undefined && upstreamPayloadAt !== undefined && firstContentAt >= upstreamPayloadAt
				? round1(firstContentAt - upstreamPayloadAt)
				: undefined,
		streamMs: diff1(responseEnd, streamStartAt),
		postResponseMs: diff1(trace.marks.spend_written, responseEnd),
	};
}

/**
 * 两个时刻之差，任一缺失时返回 undefined，保留一位小数。
 * @param to - 结束时刻
 * @param from - 开始时刻
 */
function diff1(to: number | undefined, from: number | undefined): number | undefined {
	if (to === undefined || from === undefined) {
		return undefined;
	}
	return round1(to - from);
}

/**
 * 保留一位小数，避免日志里出现浮点尾数。
 * @param value - 原始数值
 */
export function round1(value: number): number {
	return Math.round(value * 10) / 10;
}
