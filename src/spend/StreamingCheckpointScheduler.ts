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

import { streamCheckpointWrites } from "../observability/MetricCatalog";

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
 * 写入时的收尾标记。
 */
export interface StreamingCheckpointWriteOptions {
	/** `final` 为 true 表示流结束的补写，调用方应无视订阅兴趣。 */
	readonly final: boolean;
}

/**
 * 调度器配置。
 * @template T - checkpoint 载荷类型
 */
export interface StreamingCheckpointSchedulerOptions<T> {
	/** 把当前 accumulator 序列化为纯 JSON；返回 null 表示尚无内容，跳过本次写库。 */
	serialize: () => T | null;
	/**
	 * 交出一份快照：流式过程中发布到内存供详情页读取，final 时额外落库一次。
	 */
	write: (checkpoint: T, options: StreamingCheckpointWriteOptions) => void | Promise<unknown>;
	/** 写库失败回调；缺省吞掉错误。 */
	onError?: (error: unknown) => void;
	/** 时间窗口（毫秒）；缺省 400。 */
	intervalMs?: number;
	/** dispose 完成后的收尾回调（用于注销进程内实时快照）。 */
	onDispose?: () => void;
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
 * 把 checkpoint 序列化成可比较的字符串；只用于选择写库窗口和判断内容是否变化，
 * 序列化失败时返回 undefined，调用方按「有变化」处理，宁可多写一次也不漏写。
 * @param checkpoint - 序列化后的 checkpoint
 */
function stringifyCheckpoint(checkpoint: unknown): string | undefined {
	try {
		return JSON.stringify(checkpoint) ?? undefined;
	} catch {
		return undefined;
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
	private readonly _write: (checkpoint: T, options: StreamingCheckpointWriteOptions) => void | Promise<unknown>;
	private readonly _onError: (error: unknown) => void;
	private readonly _onDispose: (() => void) | undefined;
	private readonly _baseIntervalMs: number;
	private readonly _largeIntervalMs: number;
	private _intervalMs: number;
	private _slowFlushes = 0;
	private _tail: Promise<void> = Promise.resolve();
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _dirty = false;
	/** 上一次成功排队写入的负载签名；内容没变就不再重复写同一条 jsonb。 */
	private _lastSignature: string | undefined;
	private _skippedUnchanged = 0;

	constructor(options: StreamingCheckpointSchedulerOptions<T>) {
		this._serialize = options.serialize;
		this._write = options.write;
		this._onError = options.onError ?? (() => undefined);
		this._onDispose = options.onDispose;
		this._baseIntervalMs =
			options.intervalMs ?? resolveStreamingCheckpointIntervalMs(process.env[STREAMING_CHECKPOINT_INTERVAL_ENV]);
		this._intervalMs = this._baseIntervalMs;
		this._largeIntervalMs = Math.max(this._baseIntervalMs, LARGE_STREAMING_CHECKPOINT_INTERVAL_MS);
	}

	/**
	 * 每个 chunk 累积后调用。只置 dirty 并启动定时器；时间窗口内的后续调用只更新
	 * dirty 标志，由定时器到期时统一 flush 一次，实现 trailing-edge debounce，避免逐
	 * chunk 打库。
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
	 * 立即序列化当前状态并交出去。写入通过 _tail 串行队列排队，保证多次 flush 按调用
	 * 顺序执行、不并发；write 抛错由 onError 吞掉，本方法绝不 reject。serialize 返回
	 * null（尚无内容）时跳过本次。
	 *
	 * 流式过程中这份内容只发布到进程内存供详情页读取（见 LiveResponseRegistry），
	 * 只有 final（流结束）才需要真正落库；因此 final 必须绕过去重，否则内容与上一次
	 * 相同时会漏掉收尾落库，崩溃恢复就拿不到最终 usage。
	 * @param options - final 为 true 表示流结束的收尾写入
	 */
	flush(options: { readonly final?: boolean } = {}): Promise<void> {
		this._clearTimer();
		this._dirty = false;
		const final = options.final === true;
		const checkpoint = this._serialize();
		if (checkpoint === null) {
			return this._tail;
		}
		const serialized = stringifyCheckpoint(checkpoint);
		this._adaptWindow(serialized?.length ?? 0);
		if (!final && serialized !== undefined && serialized === this._lastSignature) {
			this._skippedUnchanged += 1;
			streamCheckpointWrites.inc({ outcome: "skipped" });
			return this._tail;
		}
		this._tail = this._tail
			.then(() => this._write(checkpoint, { final: final }))
			.then(() => {
				this._lastSignature = serialized;
				streamCheckpointWrites.inc({ outcome: "written" });
			})
			.catch((error: unknown) => {
				// 本次没写成，签名不能代表「已落库」，否则后续相同内容会被误判为无变化。
				this._lastSignature = undefined;
				streamCheckpointWrites.inc({ outcome: "failed" });
				this._onError(error);
			});
		return this._tail;
	}

	/**
	 * 流结束前调用：停止定时器，做最后一次 final flush 并等待串行队列清空。必须放在
	 * finalize（删除 ActiveRequests 行）之前 await，保证最后一次落库先于行删除，
	 * 进程崩溃时恢复流程仍能拿到最终 usage。
	 */
	async dispose(): Promise<void> {
		this._clearTimer();
		try {
			await this.flush({ final: true });
		} finally {
			this._onDispose?.();
		}
	}

	/**
	 * 按负载大小在快速/慢速窗口之间切换。
	 *
	 * 快速窗口下每次写库顺带量一次大小（文本负载只有几十 KB，代价可忽略）；一旦超过阈值
	 * 就退回慢窗口。慢窗口下每隔 SLOW_WINDOW_RECHECK_FLUSHES 次复测，负载回落后恢复。
	 * @param bytes - 本次 checkpoint 序列化后的字节数
	 */
	private _adaptWindow(bytes: number): void {
		if (this._largeIntervalMs === this._baseIntervalMs) {
			return;
		}
		if (this._intervalMs === this._baseIntervalMs) {
			if (bytes > MAX_FAST_CHECKPOINT_BYTES) {
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
		if (bytes <= MAX_FAST_CHECKPOINT_BYTES) {
			this._intervalMs = this._baseIntervalMs;
		}
	}

	private _clearTimer(): void {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
	}

	/** 因内容未变化而跳过的写库次数；用于诊断与测试。 */
	get skippedUnchanged(): number {
		return this._skippedUnchanged;
	}
}
