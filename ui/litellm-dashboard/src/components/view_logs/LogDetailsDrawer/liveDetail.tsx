/**
 * 日志详情页的"静态 / 实时"分流。
 *
 * 进行中的请求每 400ms 就有新的 checkpoint 落库，日志流随之推送增量帧。如果整份详情
 * 负载每帧都换新对象，React 会把 Request/Response、Routing、Metadata、Guardrail 等
 * 只在请求开始时确定的区域全部重渲染一遍——这些区域内容没变，重渲染纯属浪费，长对话
 * 还要每帧重新渲染整段 Markdown，体感上就是"整个详情页在闪"。
 *
 * 这里把字段分成两类：
 * - 静态字段：请求开始后就确定（模型、消息、路由链、metadata 等），流式期间引用不变。
 * - 高频字段：响应、token、次数、耗时，每帧都变，由 `LogDetailLiveProvider` 单独注入。
 *
 * 详情主体用 `memo` + 只比较静态字段的 `areLogDetailContentPropsEqual` 判断是否重渲染；
 * 真正变化的响应/指标由 context 送到对应区域。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { LogEntry } from "../columns";

/** 高频变化的字段：详情主体判断是否重渲染时忽略，改由 context 推送。 */
export const LIVE_DETAIL_KEYS = [
	"response",
	"prompt_tokens",
	"completion_tokens",
	"total_tokens",
	"usage",
	"request_duration_ms",
	"endTime",
	"completionStartTime",
] as const;

const LIVE_DETAIL_KEY_SET: ReadonlySet<string> = new Set(LIVE_DETAIL_KEYS);

/** 实时指标切片；字段本身就是标量，比较成本可以忽略。 */
export interface LogDetailLiveMetrics {
	readonly prompt_tokens?: number;
	readonly completion_tokens?: number;
	readonly total_tokens?: number;
	readonly request_duration_ms?: number | null;
	readonly endTime?: string;
	readonly completionStartTime?: string | null;
}

/** 详情页实时值的只读快照，供 Provider 注入。 */
export interface LiveDetailValues {
	readonly response: unknown;
	readonly metrics: LogDetailLiveMetrics;
}

interface LiveResponseValue {
	readonly response: unknown;
}

const ResponseContext = createContext<LiveResponseValue | null>(null);
const MetricsContext = createContext<LogDetailLiveMetrics | null>(null);

export interface LogDetailLiveProviderProps {
	/** 当前响应（流式期间每次 checkpoint 变化） */
	response: unknown;
	/** 当前指标切片 */
	metrics: LogDetailLiveMetrics;
	children: ReactNode;
}

/**
 * 向详情页注入实时值。
 *
 * 两个 context 分开：响应变化不会连带重渲染只读指标的区域，反之亦然。
 * @param props - 实时值与子树
 */
export function LogDetailLiveProvider({ response, metrics, children }: LogDetailLiveProviderProps) {
	const responseValue = useMemo<LiveResponseValue>(() => ({ response }), [response]);
	const { prompt_tokens, completion_tokens, total_tokens, request_duration_ms, endTime, completionStartTime } = metrics;
	const metricsValue = useMemo<LogDetailLiveMetrics>(
		() => ({ prompt_tokens, completion_tokens, total_tokens, request_duration_ms, endTime, completionStartTime }),
		[prompt_tokens, completion_tokens, total_tokens, request_duration_ms, endTime, completionStartTime],
	);
	return (
		<ResponseContext.Provider value={responseValue}>
			<MetricsContext.Provider value={metricsValue}>{children}</MetricsContext.Provider>
		</ResponseContext.Provider>
	);
}

/**
 * 读取实时响应；没有 Provider 时回退到传入值（详情页也可以脱离抽屉单独渲染）。
 * @param fallback - 无 Provider 时使用的值
 */
export function useLiveLogResponse<T>(fallback: T): T {
	const value = useContext(ResponseContext);
	return value === null ? fallback : (value.response as T);
}

/**
 * 读取实时指标；没有 Provider 时回退到静态条目上的同名字段。
 * @param fallback - 无 Provider 时使用的值
 */
export function useLiveLogMetrics(fallback: LogDetailLiveMetrics): LogDetailLiveMetrics {
	const value = useContext(MetricsContext);
	return value ?? fallback;
}

/**
 * 从合并后的日志条目里取出实时值。
 * @param entry - 列表行与详情接口（或推送帧）合并后的条目
 */
export function readLiveDetailValues(entry: LogEntry | null): LiveDetailValues {
	return {
		response: entry?.response,
		metrics: {
			prompt_tokens: entry?.prompt_tokens,
			completion_tokens: entry?.completion_tokens,
			total_tokens: entry?.total_tokens,
			request_duration_ms: entry?.request_duration_ms,
			endTime: entry?.endTime,
			completionStartTime: entry?.completionStartTime,
		},
	};
}

/**
 * 条目是否仍在进行中。
 * @param entry - 日志条目
 */
export function isEntryInProgress(entry: LogEntry | null | undefined): boolean {
	return entry?.status === "in_progress" || entry?.metadata?.status === "in_progress";
}

/**
 * 两个条目的静态字段是否完全一致（引用比较）。
 *
 * 推送帧只覆盖变化字段，未变化的对象引用保持不变，所以引用比较就能判断"静态内容有没有变"。
 * @param previous - 上一个条目
 * @param next - 当前条目
 */
export function areSameStaticLogFields(previous: LogEntry, next: LogEntry): boolean {
	const previousKeys = Object.keys(previous).filter((key) => !LIVE_DETAIL_KEY_SET.has(key));
	const nextKeys = Object.keys(next).filter((key) => !LIVE_DETAIL_KEY_SET.has(key));
	if (previousKeys.length !== nextKeys.length) {
		return false;
	}
	for (const key of nextKeys) {
		if (!Object.is(previous[key as keyof LogEntry], next[key as keyof LogEntry])) {
			return false;
		}
	}
	return true;
}
