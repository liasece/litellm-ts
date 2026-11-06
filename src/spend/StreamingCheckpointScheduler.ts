/**
 * 流式 checkpoint 调度器
 *
 * 在流式响应过程中，按时间窗口把 accumulator 的部分响应定期持久化到 ActiveRequests，
 * 供日志详情页在请求进行中也能查看当前已累积的 response。
 *
 * - 串行队列（对齐 CliProxyResponsesExecution._queueCheckpoint）：多次写库按触发顺序串行，
 *   避免并发 UPDATE 乱序。
 * - trailing debounce：每个 chunk 后调用 onChunk，只在 intervalMs 时间窗口尾部写一次，
 *   不逐 chunk 写库。
 * - 双速窗口：默认 400ms 让进行中的日志看起来接近实时；检测到大负载（图片 base64 等）
 *   自动退回 2s，避免把数兆 jsonb 反复重写。
 * - 失败不阻断流：write 抛错由 onError 吞掉，flush 绝不 throw。
 */

/** 流式 checkpoint 的统一中间响应结构。 */
export interface StreamingCheckpoint {
	/** 流式协议。 */
	protocol: "chat_completions" | "anthropic_messages" | "responses" | "responses_native";
	/** 流中只写 in_progress；终态由最终 SpendLog 或 Recovery 决定。 */
	state: "in_progress";
	/** 各端点 response builder 产出的部分响应；尚无内容时为 null。 */
	response: Record<string, unknown> | null;
	/** 归一化 usage（至少含 prompt/completion/total_tokens）；尚未产生时为 null。 */
	usage: Record<string, unknown> | null;
	/** 上游请求（litellm 发给 provider 的脱敏请求）；进行中即可见，用于日志详情页 Upstream 视图。 */
	upstream_request?: Record<string, unknown> | null;
	/** 上游响应（provider 返回的脱敏响应，流式中通常只有 status/headers）；可为 null。 */
	upstream_response?: Record<string, unknown> | null;
}

/**
 * 调度器配置。
 * @template T - checkpoint 载荷类型
 */
export interface StreamingCheckpointSchedulerOptions<T> {
	/** 把当前 accumulator 序列化为纯 JSON；返回 null 表示尚无内容，跳过本次写库。 */
	serialize: () => T | null;
	/** 把序列化结果写入存储（通常是 checkpointActiveRequest 包装）。 */
	write: (checkpoint: T) => void | Promise<unknown>;
	/** 写库失败回调；缺省吞掉错误。 */
	onError?: (error: unknown) => void;
	/**
	 * 首个 chunk 到达时同步回调一次；用于补写 TTFT 这类「一确定就不再变化」的字段。
	 * 与 onChunk 的 debounce 无关：首 token 时间必须按到达时刻记录，不能等写库窗口。
	 */
	onFirstChunk?: () => void;
	/** 时间窗口（毫秒）；缺省 2000。 */
	intervalMs?: number;
}

/** 进行中日志的刷新窗口；400ms 下详情页约每秒更新 2~3 次，接近实时。 */
export const DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS = 400;

/** 大负载退回的窗口：图片 base64 这类负载高频重写整块 jsonb 不值得。 */
export const LARGE_STREAMING_CHECKPOINT_INTERVAL_MS = 2000;

/** 超过该字节数即视为大负载。 */
export const MAX_FAST_CHECKPOINT_BYTES = 512 * 1024;

/** 运维可在不重建镜像的情况下调整快速窗口。 */
export const STREAMING_CHECKPOINT_INTERVAL_ENV = "LITELLM_STREAMING_CHECKPOINT_INTERVAL_MS";

/** 快速窗口下限：再密也只会把写库放大，不会让页面更快。 */
const MIN_STREAMING_CHECKPOINT_INTERVAL_MS = 200;

/** 快速窗口上限：超过它就该用环境变量而不是代码默认值。 */
const MAX_STREAMING_CHECKPOINT_INTERVAL_MS = 5000;

/** 慢窗口下每隔多少次写库复测一次负载大小，允许图片结束后回到快速窗口。 */
const SLOW_WINDOW_RECHECK_FLUSHES = 8;

/**
 * 解析 checkpoint 刷新窗口，并把异常输入夹到可用范围。
 * @param raw - 环境变量原文；缺省或非法时用默认值
 */
export function resolveStreamingCheckpointIntervalMs(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") {
		return DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS;
	}
	return Math.min(MAX_STREAMING_CHECKPOINT_INTERVAL_MS, Math.max(MIN_STREAMING_CHECKPOINT_INTERVAL_MS, Math.round(parsed)));
}

/**
 * 估算 checkpoint 的字节数；只用于选择写库窗口，失败时按小负载处理。
 * @param checkpoint - 序列化后的 checkpoint
 */
function estimateCheckpointBytes(checkpoint: unknown): number {
	try {
		return JSON.stringify(checkpoint)?.length ?? 0;
	} catch {
		return 0;
	}
}

/**
 * 流式 checkpoint 调度器。
 * @template T - checkpoint 载荷类型
 *
 * 语义约定：
 * - onChunk：流每产生一个 chunk 后调用，只置 dirty 并安排一次 trailing-edge 写库，
 *   时间窗口内多次调用合并为一次，避免逐 chunk 打库。
 * - flush：立即序列化当前状态并写入；写入串到串行队列尾部，绝不并发、绝不 throw。
 * - dispose：流结束前调用，flush 最后一段尚未落库的内容并等待队列清空。
 * - serialize 返回 null 表示「尚无内容」，跳过本次写库（例如流还未产生任何 token）。
 */
export class StreamingCheckpointScheduler<T> {
	private readonly _serialize: () => T | null;
	private readonly _write: (checkpoint: T) => void | Promise<unknown>;
	private readonly _onError: (error: unknown) => void;
	private readonly _onFirstChunk: (() => void) | undefined;
	private readonly _baseIntervalMs: number;
	private readonly _largeIntervalMs: number;
	private _intervalMs: number;
	private _slowFlushes = 0;
	private _firstChunkSeen = false;
	private _tail: Promise<void> = Promise.resolve();
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _dirty = false;

	constructor(options: StreamingCheckpointSchedulerOptions<T>) {
		this._serialize = options.serialize;
		this._write = options.write;
		this._onError = options.onError ?? (() => undefined);
		this._onFirstChunk = options.onFirstChunk;
		this._baseIntervalMs =
			options.intervalMs ?? resolveStreamingCheckpointIntervalMs(process.env[STREAMING_CHECKPOINT_INTERVAL_ENV]);
		this._intervalMs = this._baseIntervalMs;
		this._largeIntervalMs = Math.max(this._baseIntervalMs, LARGE_STREAMING_CHECKPOINT_INTERVAL_MS);
	}

	/**
	 * 每个 chunk 累积后调用。只置 dirty 并在首次调用时启动定时器；时间窗口内的
	 * 后续调用只更新 dirty 标志，由定时器到期时统一 flush 一次，实现 trailing-edge
	 * debounce，避免逐 chunk 打库。
	 */
	onChunk(): void {
		if (!this._firstChunkSeen) {
			this._firstChunkSeen = true;
			try {
				this._onFirstChunk?.();
			} catch {
				// 首 token 补写属于观测，不能影响流式转发。
			}
		}
		this._dirty = true;
		if (this._timer !== undefined) {
			return;
		}
		this._timer = setTimeout(() => {
			this._timer = undefined;
			if (this._dirty) {
				this._dirty = false;
				void this.flush();
			}
		}, this._intervalMs);
		this._timer.unref();
	}

	/**
	 * 立即序列化当前状态并写入。写入通过 _tail 串行队列排队，保证多次 flush 按调用
	 * 顺序落库、不并发；write 抛错由 onError 吞掉，本方法绝不 reject。serialize 返回
	 * null（尚无内容）时跳过写库。
	 */
	flush(): Promise<void> {
		this._clearTimer();
		this._dirty = false;
		const checkpoint = this._serialize();
		if (checkpoint === null) {
			return this._tail;
		}
		this._adaptWindow(checkpoint);
		this._tail = this._tail
			.then(() => this._write(checkpoint))
			.then(() => undefined)
			.catch((error: unknown) => {
				this._onError(error);
			});
		return this._tail;
	}

	/**
	 * 流结束前调用：停止定时器，若仍有未落库的 dirty 状态则做最后一次 flush，并等待
	 * 串行队列清空。必须在 finalize（删除 ActiveRequests 行）之前 await，保证最后一段
	 * partial 在行删除前有机会落库。
	 */
	dispose(): Promise<void> {
		this._clearTimer();
		if (this._dirty) {
			return this.flush();
		}
		return this._tail;
	}

	/**
	 * 按负载大小在快速/慢速窗口之间切换。
	 *
	 * 快速窗口下每次写库顺带量一次大小（文本负载只有几十 KB，代价可忽略）；一旦超过阈值
	 * 就退回慢窗口。慢窗口下每隔 SLOW_WINDOW_RECHECK_FLUSHES 次复测，负载回落后恢复。
	 * @param checkpoint - 本次即将写库的 checkpoint
	 */
	private _adaptWindow(checkpoint: T): void {
		if (this._largeIntervalMs === this._baseIntervalMs) {
			return;
		}
		if (this._intervalMs === this._baseIntervalMs) {
			if (estimateCheckpointBytes(checkpoint) > MAX_FAST_CHECKPOINT_BYTES) {
				this._intervalMs = this._largeIntervalMs;
				this._slowFlushes = 0;
			}
			return;
		}
		this._slowFlushes += 1;
		if (this._slowFlushes < SLOW_WINDOW_RECHECK_FLUSHES) {
			return;
		}
		this._slowFlushes = 0;
		if (estimateCheckpointBytes(checkpoint) <= MAX_FAST_CHECKPOINT_BYTES) {
			this._intervalMs = this._baseIntervalMs;
		}
	}

	private _clearTimer(): void {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}
}
