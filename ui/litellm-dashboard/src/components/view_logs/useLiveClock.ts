import { useCallback, useSyncExternalStore } from "react";

/**
 * 进行中的请求由前端按秒推进耗时。
 *
 * 列表和详情都只在收到服务端推送/刷新时才会更新耗时：上游长时间没有产出、或者 Live Tail
 * 用 10 秒这样的间隔兜底时，界面上的 Duration 会一段一段跳。这里提供一个共享的秒级时钟，
 * 只让订阅它的单元格每秒重渲染一次，列表其余部分不受影响。
 */

/** 时钟推进步长（毫秒）。 */
export const LIVE_CLOCK_INTERVAL_MS = 1000;

/** 当前时钟读数；随 `tick()` 更新，供 `useSyncExternalStore` 取快照。 */
let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
	nowMs = Date.now();
	for (const listener of listeners) {
		listener();
	}
}

/**
 * 订阅共享时钟；首个订阅者到达时启动定时器，最后一个离开时停掉。
 * @param listener - 订阅回调
 * @returns 取消订阅函数
 */
function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (timer === null) {
		nowMs = Date.now();
		timer = setInterval(tick, LIVE_CLOCK_INTERVAL_MS);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	};
}

function getSnapshot(): number {
	return nowMs;
}

/**
 * 共享的秒级时钟读数。
 * @param active - 是否订阅；为 false 时不启动定时器
 * @returns 最后一次 tick 的毫秒时间戳
 */
export function useLiveClockMs(active = true): number {
	const subscribeWhenActive = useCallback(
		(onStoreChange: () => void) => (active ? subscribe(onStoreChange) : () => undefined),
		[active],
	);
	return useSyncExternalStore(subscribeWhenActive, getSnapshot, getSnapshot);
}

/**
 * 把开始时间统一成毫秒时间戳。
 * @param value - ISO 字符串、毫秒时间戳或空值
 * @returns 毫秒时间戳；无法解析时为 null
 */
function toTimestamp(value: string | number | null | undefined): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string" && value.length > 0) {
		const parsed = new Date(value).getTime();
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

/**
 * 进行中请求的耗时，按秒推进。
 *
 * 用客户端时钟减去 startTime，避免服务端推送间隔造成的停顿；服务端给出的耗时作为下限，
 * 两边时钟有偏差时读数只会前进、不会回退。请求结束后直接返回落账值。
 * @param startTime - 请求开始时间
 * @param active - 是否仍在进行中
 * @param serverDurationMs - 服务端提供、或以服务端为准的耗时
 * @returns 耗时（毫秒）；开始时间不可解析且没有服务端值时返回 null
 */
export function useLiveDurationMs(
	startTime: string | number | null | undefined,
	active: boolean,
	serverDurationMs?: number | null,
): number | null {
	const nowMs = useLiveClockMs(active);
	if (!active) {
		return serverDurationMs ?? null;
	}
	const startedAt = toTimestamp(startTime);
	if (startedAt === null) {
		return serverDurationMs ?? null;
	}
	return Math.max(nowMs - startedAt, serverDurationMs ?? 0, 0);
}
