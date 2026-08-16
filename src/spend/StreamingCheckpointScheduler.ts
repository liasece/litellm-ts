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
	/** 时间窗口（毫秒）；缺省 2000。 */
	intervalMs?: number;
}

export const DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS = 2000;

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
	private readonly _intervalMs: number;
	private _tail: Promise<void> = Promise.resolve();
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _dirty = false;

	constructor(options: StreamingCheckpointSchedulerOptions<T>) {
		this._serialize = options.serialize;
		this._write = options.write;
		this._onError = options.onError ?? (() => undefined);
		this._intervalMs = options.intervalMs ?? DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS;
	}

	/**
	 * 每个 chunk 累积后调用。只置 dirty 并在首次调用时启动定时器；时间窗口内的
	 * 后续调用只更新 dirty 标志，由定时器到期时统一 flush 一次，实现 trailing-edge
	 * debounce，避免逐 chunk 打库。
	 */
	onChunk(): void {
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

	private _clearTimer(): void {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}
}
