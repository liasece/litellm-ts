import { ApiError } from "../core/api/ApiError";

/**
 * CLIProxy 升级/重启前的「降级 + 排空」闸门。
 *
 * 直接重启托管 CLIProxy 会把正在写的 SSE 掐断（2026-11-03 03:53:44 升级到 8.0.52 时，
 * 7 条在途请求同时以 `terminated` 失败）。因此升级流程改为四步：
 *
 * 1. 降级：`beginCliProxyDrain()` 之后 Router 选择候选时跳过 CLIProxy deployment，
 *    新请求自然落到 fallback 链（例如 `commandcode/...` → `deepseek-v4-flash`）；
 *    直连 CLIProxy 的原生端点拿不到候选，直接返回 503。
 * 2. 排空：`awaitCliProxyIdle()` 等待在途请求结束，避免重启截断流。
 * 3. 升级：切换版本并重启进程。
 * 4. 恢复：`endCliProxyDrain()`，新请求重新进入 CLIProxy。
 *
 * 排空有上限：超时后记录剩余在途数并继续升级，被截断的流由 Router 的流式 fallback 兜底。
 */

/** 排空等待上限（秒）。默认值与线上实际生成时长对齐：单条流常跑到 60~120 秒。 */
export const CLIPROXY_DRAIN_TIMEOUT_ENV = "CLIPROXY_DRAIN_TIMEOUT_SECONDS";

/** 默认排空等待上限（秒）。 */
export const CLIPROXY_DEFAULT_DRAIN_TIMEOUT_SECONDS = 120;

/** 轮询在途请求的间隔：排空是升级路径上的短等待，50ms 足够灵敏。 */
const DRAIN_POLL_INTERVAL_MS = 50;

let draining = false;
let drainingSince: number | null = null;
let inFlightRequests = 0;
const idleWaiters = new Set<() => void>();

/**
 * 当前是否处于排空阶段。
 * 降级入口（Router 候选过滤、直连端点准入）都读这个标志。
 */
export function isCliProxyDraining(): boolean {
	return draining;
}

/** 进入排空阶段：此后新请求不再进 CLIProxy。重复调用保持首次开始时间。 */
export function beginCliProxyDrain(): void {
	if (draining) {
		return;
	}
	draining = true;
	drainingSince = Date.now();
}

/** 退出排空阶段并唤醒所有等待排空的调用方。 */
export function endCliProxyDrain(): void {
	draining = false;
	drainingSince = null;
	const waiters = [...idleWaiters];
	idleWaiters.clear();
	for (const waiter of waiters) {
		waiter();
	}
}

/**
 * 排空状态快照，供管理接口、状态窗口与日志使用。
 */
export function getCliProxyDrainSnapshot(): {
	draining: boolean;
	draining_since: string | null;
	in_flight_requests: number;
} {
	return {
		draining: draining,
		draining_since: drainingSince === null ? null : new Date(drainingSince).toISOString(),
		in_flight_requests: inFlightRequests,
	};
}

/**
 * 登记一个已经进入 CLIProxy 的请求，返回幂等释放函数。
 *
 * 只用于「重启会把它截断」的直连路径（原生 passthrough / native Responses）；
 * 经过 Router 的请求由 Router 自己的在途计数统计，避免重复计数。
 */
export function trackCliProxyRequest(): () => void {
	inFlightRequests += 1;
	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		inFlightRequests = Math.max(0, inFlightRequests - 1);
		if (inFlightRequests === 0) {
			for (const waiter of [...idleWaiters]) {
				waiter();
			}
		}
	};
}

/**
 * 尝试进入 CLIProxy；排空阶段直接拒绝。
 *
 * 给无法 fallback 的直连端点用：升级窗口里它们没有别的候选可去，
 * 与其被重启截断，不如明确返回 503 让调用方重试。
 * @returns 幂等释放函数
 * @throws ApiError 503 当运行时不接受新请求（排空阶段）
 */
export function enterCliProxyRequest(): () => void {
	if (draining) {
		throw ApiError.unavailable("CLIProxy 正在升级，暂时不接受新请求，请稍后重试");
	}
	return trackCliProxyRequest();
}

/**
 * 解析排空等待上限（秒 → 毫秒）；非法或非正数退回默认值。
 * @param env - 进程环境变量
 */
export function resolveCliProxyDrainTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env[CLIPROXY_DRAIN_TIMEOUT_ENV];
	const seconds = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
	const effective = Number.isFinite(seconds) && seconds >= 0 ? seconds : CLIPROXY_DEFAULT_DRAIN_TIMEOUT_SECONDS;
	return Math.round(effective * 1000);
}

/**
 * 等待在途请求归零。
 * @param externalProbe - 外部在途计数（Router 侧的在途请求），与闸门自身计数相加
 * @param timeoutMs - 等待上限；0 表示只看一眼不等待
 * @returns 是否排空、超时剩余数、实际等待时长
 */
export async function awaitCliProxyIdle(
	externalProbe: () => number,
	timeoutMs: number,
): Promise<{ idle: boolean; remaining: number; waitedMs: number }> {
	const startedAt = Date.now();
	const deadline = startedAt + Math.max(0, timeoutMs);
	while (true) {
		let external = 0;
		try {
			external = Math.max(0, Math.trunc(externalProbe()));
		} catch {
			external = 0;
		}
		const remaining = inFlightRequests + external;
		if (remaining === 0) {
			return { idle: true, remaining: 0, waitedMs: Date.now() - startedAt };
		}
		if (Date.now() >= deadline) {
			return { idle: false, remaining: remaining, waitedMs: Date.now() - startedAt };
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				idleWaiters.delete(wake);
				resolve();
			}, DRAIN_POLL_INTERVAL_MS);
			const wake = (): void => {
				clearTimeout(timer);
				resolve();
			};
			idleWaiters.add(wake);
		});
	}
}


/** 排空阶段的可观察事件，供运行时写进日志。 */
export interface CliProxyDrainOptions {
	/** 外部在途计数（Router 侧的在途请求）。 */
	readonly probe: () => number;
	/** 等待上限；0 表示不等待直接重启。 */
	readonly timeoutMs: number;
	/** 进入降级时回调，参数是当时的在途请求数。 */
	readonly onStart?: (inFlight: number) => void;
	/** 排空结束时回调；idle=false 表示超时后继续。 */
	readonly onSettled?: (result: {
		idle: boolean;
		remaining: number;
		waitedMs: number;
		timeoutMs: number;
	}) => void;
}

/**
 * 在「降级 + 排空」窗口里执行一次 CLIProxy 重启。
 *
 * 顺序固定：进入降级 → 等排空（有上限）→ 执行 work → 无论成败都退出降级。
 * work 抛错时同样退出降级，避免一次失败的重启把 CLIProxy 永久留在降级态。
 * @template T - 重启动作的返回值类型
 * @param work - 真正做重启的动作
 * @param options - 探针、等待上限与阶段回调
 * @returns 重启动作的返回值
 */
export async function withCliProxyDrain<T>(work: () => Promise<T>, options: CliProxyDrainOptions): Promise<T> {
	beginCliProxyDrain();
	try {
		let external = 0;
		try {
			external = Math.max(0, Math.trunc(options.probe()));
		} catch {
			external = 0;
		}
		options.onStart?.(getCliProxyDrainSnapshot().in_flight_requests + external);
		const result = await awaitCliProxyIdle(options.probe, options.timeoutMs);
		options.onSettled?.({ ...result, timeoutMs: options.timeoutMs });
		return await work();
	} finally {
		endCliProxyDrain();
	}
}

/**
 * 仅用于测试：重置闸门状态，避免用例之间互相污染。
 */
export function resetCliProxyDrainGateForTest(): void {
	draining = false;
	drainingSince = null;
	inFlightRequests = 0;
	idleWaiters.clear();
}
