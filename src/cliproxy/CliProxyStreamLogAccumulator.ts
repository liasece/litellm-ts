/**
 * CLIProxy 透传流的日志累积器。
 *
 * 透传端点把上游字节原样转发给客户端，只能在旁路把 SSE 事件增量解析成日志副本：
 * 同一份累积器既供「流结束后写完整日志」使用（`extract*StreamResponse`），也供
 * 「流进行中写 checkpoint」使用，避免两条路径对同一份字节给出不同结论。
 *
 * 语义约定：
 * - `feed` 允许任意切分，跨 chunk 的半帧留在缓冲区，等后续字节补齐。
 * - `finish` 用于流结束：把缓冲区里的尾部帧也吃掉。此前实现就是按整段文本切帧，
 *   尾部帧同样会被解析，这里保持一致。
 * - `snapshot` 只读、不消费缓冲区，可随时调用；尚无内容时返回 undefined。
 *
 * `createLiveStreamCheckpoint` 把累积器接到 checkpoint 调度器上，供透传端点在转发同时
 * 写进行中的日志详情。
 */

import type { DrizzleDb } from "../core/db/Database";
import { NativeResponsesAccumulator, isRecord } from "../proxy/NativeResponsesAccumulator";
import { checkpointActiveRequest } from "../spend/SpendTracker";
import { StreamingCheckpointScheduler, type StreamingCheckpoint } from "../spend/StreamingCheckpointScheduler";

/** 进行中的透传流 checkpoint：喂字节、收尾落盘。 */
export interface LiveStreamCheckpoint {
	/** 转发过程中把解码片段喂进来。 */
	feed(decoded: string): void;
	/** 流结束或异常收尾：落最后一段并可重复调用。 */
	dispose(): Promise<void>;
}

/**
 * 为透传流建立实时 checkpoint。
 *
 * 透传端点只搬字节，不做协议解析；若不旁路累积，进行中的日志详情在整条流里都没有
 * response 可看。这里复用兼容端点同一套累积器与调度器，按窗口把部分响应写进
 * `streaming_execution`，让详情页与普通流式模型表现一致。
 * @param options - 数据库、请求 ID、协议与上游请求快照
 */
export function createLiveStreamCheckpoint(options: {
	readonly db: DrizzleDb;
	readonly requestId: string;
	readonly protocol: StreamingCheckpoint["protocol"];
	readonly currentUpstreamRequest: () => unknown;
	/** 首个 chunk 到达时回调一次；用于把 TTFT 补写进在途行。 */
	readonly onFirstChunk?: () => void;
}): LiveStreamCheckpoint {
	const accumulator =
		options.protocol === "anthropic_messages"
			? createAnthropicStreamLogAccumulator()
			: options.protocol === "responses_native"
				? createResponsesStreamLogAccumulator()
				: createChatStreamLogAccumulator();
	const scheduler = new StreamingCheckpointScheduler<StreamingCheckpoint>({
		serialize: () => {
			const snapshot = accumulator.snapshot();
			if (!snapshot) {
				return null;
			}
			return {
				protocol: options.protocol,
				state: "in_progress",
				response: snapshot.response ?? null,
				usage: snapshot.usage ?? null,
				upstream_request: (options.currentUpstreamRequest() ?? null) as Record<string, unknown> | null,
			};
		},
		write: (checkpoint) => checkpointActiveRequest(options.db, options.requestId, checkpoint, "streaming_execution"),
	});
	let disposed = false;
	let firstChunkSeen = false;
	return {
		feed: (decoded: string): void => {
			accumulator.feed(decoded);
			if (!firstChunkSeen) {
				firstChunkSeen = true;
				try {
					options.onFirstChunk?.();
				} catch {
					// 首个 chunk 的 TTFT 补写属于观测，不能影响透传转发。
				}
			}
			scheduler.onChunk();
		},
		dispose: async (): Promise<void> => {
			if (disposed) {
				return;
			}
			disposed = true;
			accumulator.finish();
			await scheduler.dispose();
		},
	};
}

/** 一次日志快照：与最终日志里 response/usage 同形。 */
export interface CliProxyStreamLogSnapshot {
	/** 累积出的响应体；chat 与 anthropic 各自的原生形状。 */
	readonly response?: Record<string, unknown>;
	/** 归一化用量；上游尚未给出时为 undefined。 */
	readonly usage?: Record<string, unknown>;
}

/** 增量日志累积器。 */
export interface CliProxyStreamLogAccumulator {
	/** 吃下解码后的字节片段，可跨帧切断。 */
	feed(decoded: string): void;
	/** 流结束：把尾部未闭合的帧也解析掉。 */
	finish(): void;
	/** 当前累积出的日志副本。 */
	snapshot(): CliProxyStreamLogSnapshot | undefined;
}

/**
 * 把一条 SSE 事件解析成 JSON 负载；`data:` 多行会先拼成一行。
 * @param event - 单条事件（不含结束空行）
 */
export function parseResponsesSseEvent(event: string): Record<string, unknown> | null {
	const data = event
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^ /, ""))
		.join("\n");
	if (!data) {
		return null;
	}
	try {
		const payload: unknown = JSON.parse(data);
		return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * 归一化用量字段，兼容 Chat/Responses 与 Anthropic 两种形状。
 * @param value - 上游给出的 usage 对象
 */
export function normalizeNativeUsage(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const usage = value as Record<string, unknown>;
	const cacheRead = typeof usage["cache_read_input_tokens"] === "number" ? usage["cache_read_input_tokens"] : 0;
	const cacheCreation = typeof usage["cache_creation_input_tokens"] === "number" ? usage["cache_creation_input_tokens"] : 0;
	const rawPrompt = typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : undefined;
	// Anthropic 原生形状（无 prompt_tokens，有 input_tokens）：input_tokens 不含 cache，
	// 按 PY transformation.py:1587-1611 折叠 cache_read + cache_creation 进 prompt_tokens；
	// 否则（Chat/Responses 形状）prompt/input 已含 cache，直接沿用。
	const prompt = rawPrompt ?? (typeof usage["input_tokens"] === "number" ? usage["input_tokens"] + cacheRead + cacheCreation : 0);
	const completion =
		typeof usage["completion_tokens"] === "number"
			? usage["completion_tokens"]
			: typeof usage["output_tokens"] === "number"
				? usage["output_tokens"]
				: 0;
	if (prompt === 0 && completion === 0 && typeof usage["total_tokens"] !== "number") {
		return undefined;
	}
	return {
		...usage,
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: typeof usage["total_tokens"] === "number" ? usage["total_tokens"] : prompt + completion,
	};
}

/** SSE 帧边界：空行分隔事件，允许 CRLF。 */
const SSE_EVENT_BOUNDARY = /\r?\n\r?\n/;

/**
 * 帧切分缓冲：`feed` 时只吐出已经闭合的事件，`finish` 时吐出尾部残帧。
 */
class SseEventBuffer {
	private _pending = "";

	/**
	 * 追加密钥字节并返回本次可解析的完整事件。
	 * @param decoded - 解码后的文本片段
	 */
	push(decoded: string): string[] {
		this._pending += decoded;
		return this._drain(false);
	}

	/** 流结束：把剩余内容当成最后一个事件。 */
	flush(): string[] {
		return this._drain(true);
	}

	private _drain(includeTail: boolean): string[] {
		const events: string[] = [];
		for (;;) {
			const boundary = SSE_EVENT_BOUNDARY.exec(this._pending);
			if (!boundary || boundary.index === undefined) {
				break;
			}
			events.push(this._pending.slice(0, boundary.index));
			this._pending = this._pending.slice(boundary.index + boundary[0].length);
		}
		if (includeTail && this._pending.trim()) {
			events.push(this._pending);
			this._pending = "";
		}
		return events;
	}
}

/**
 * 合并文本/函数参数增量，同时保留 provider 附加字段。
 * @param target - 累积目标对象
 * @param delta - 本帧增量
 */
function mergeChatLogDelta(target: Record<string, unknown>, delta: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(delta)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype" || value === null || value === undefined) {
			continue;
		}
		if (typeof value === "string" && ["content", "reasoning_content", "refusal", "name", "arguments"].includes(key)) {
			target[key] = `${typeof target[key] === "string" ? target[key] : ""}${value}`;
		} else if (Array.isArray(value)) {
			target[key] = [...(Array.isArray(target[key]) ? target[key] : []), ...value];
		} else if (typeof value === "object") {
			const previous = target[key];
			const nested: Record<string, unknown> =
				typeof previous === "object" && previous !== null && !Array.isArray(previous) ? (previous as Record<string, unknown>) : {};
			mergeChatLogDelta(nested, value as Record<string, unknown>);
			target[key] = nested;
		} else {
			target[key] = value;
		}
	}
}

interface ChatLogChoice {
	readonly fields: Record<string, unknown>;
	readonly message: Record<string, unknown>;
	readonly tools: Map<number, Record<string, unknown>>;
}

/**
 * Chat Completions SSE 的日志累积器。
 *
 * 结束事件通常只有空 delta 或 usage，日志必须累积此前的输出，不能把最后一个 chunk
 * 当成完整 response；此处只构造日志副本，不影响透传字节。
 */
export function createChatStreamLogAccumulator(): CliProxyStreamLogAccumulator {
	const base: Record<string, unknown> = {};
	const choices = new Map<number, ChatLogChoice>();
	const buffer = new SseEventBuffer();

	const consumePayload = (payload: Record<string, unknown>): void => {
		if (payload["object"] !== "chat.completion.chunk" || !Array.isArray(payload["choices"])) {
			return;
		}
		for (const [key, value] of Object.entries(payload)) {
			if (key !== "choices" && key !== "object" && value !== null && value !== undefined) {
				base[key] = value;
			}
		}
		for (const choice of payload["choices"] as Array<Record<string, unknown>>) {
			if (!choice || typeof choice["index"] !== "number") {
				continue;
			}
			const index = choice["index"];
			const accumulated = choices.get(index) ?? {
				fields: { index: index, finish_reason: null },
				message: { role: "assistant", content: null },
				tools: new Map<number, Record<string, unknown>>(),
			};
			choices.set(index, accumulated);
			for (const [key, value] of Object.entries(choice)) {
				if (key !== "delta" && value !== null && value !== undefined) {
					accumulated.fields[key] = value;
				}
			}
			const delta = choice["delta"];
			if (!delta || typeof delta !== "object" || Array.isArray(delta)) {
				continue;
			}
			const { tool_calls: toolCalls, ...messageDelta } = delta as Record<string, unknown>;
			mergeChatLogDelta(accumulated.message, messageDelta);
			if (Array.isArray(toolCalls)) {
				for (const tool of toolCalls as Array<Record<string, unknown>>) {
					if (!tool || typeof tool["index"] !== "number") {
						continue;
					}
					const toolIndex = tool["index"];
					const { index: _index, ...toolDelta } = tool;
					const accumulatedTool = accumulated.tools.get(toolIndex) ?? {};
					mergeChatLogDelta(accumulatedTool, toolDelta);
					accumulated.tools.set(toolIndex, accumulatedTool);
				}
			}
		}
	};

	const consumeEvents = (events: string[]): void => {
		for (const event of events) {
			const payload = parseResponsesSseEvent(event);
			if (payload) {
				consumePayload(payload);
			}
		}
	};

	return {
		feed: (decoded: string): void => consumeEvents(buffer.push(decoded)),
		finish: (): void => consumeEvents(buffer.flush()),
		snapshot: (): CliProxyStreamLogSnapshot | undefined => {
			if (choices.size === 0) {
				return undefined;
			}
			const response = {
				...base,
				object: "chat.completion",
				choices: [...choices.entries()]
					.sort(([left], [right]) => left - right)
					.map(([, choice]) => ({
						...choice.fields,
						message: {
							...choice.message,
							...(choice.tools.size > 0
								? {
										tool_calls: [...choice.tools.entries()].sort(([left], [right]) => left - right).map(([, tool]) => tool),
									}
								: {}),
						},
					})),
			};
			return { response: response, usage: normalizeNativeUsage(base["usage"]) };
		},
	};
}

/**
 * Responses 协议（`/v1/responses` 原生透传）SSE 的日志累积器。
 *
 * 复用兼容端点的 `NativeResponsesAccumulator`：事件级累积 `output` item，因此长流被
 * 截断也不影响进行中的可读内容，详情页的 Response 块与落账后形状一致。
 */
export function createResponsesStreamLogAccumulator(): CliProxyStreamLogAccumulator {
	const inner = new NativeResponsesAccumulator();
	const buffer = new SseEventBuffer();
	const consumeEvents = (events: string[]): void => {
		for (const event of events) {
			const payload = parseResponsesSseEvent(event);
			if (payload) {
				inner.accumulate(payload);
			}
		}
	};
	return {
		feed: (decoded: string): void => consumeEvents(buffer.push(decoded)),
		finish: (): void => consumeEvents(buffer.flush()),
		snapshot: (): CliProxyStreamLogSnapshot | undefined => {
			const response = inner.snapshot();
			if (!response) {
				return undefined;
			}
			return { response: response, usage: isRecord(response["usage"]) ? response["usage"] : undefined };
		},
	};
}

/**
 * Anthropic Messages SSE 的日志累积器。
 *
 * 事件类型包含 message_start / content_block_* / message_delta；文本、思考、签名与
 * 工具入参都要按块拼接，usage 随 message_start 与 message_delta 分段给出。
 */
export function createAnthropicStreamLogAccumulator(): CliProxyStreamLogAccumulator {
	let message: Record<string, unknown> | undefined;
	const content = new Map<number, Record<string, unknown>>();
	const toolInputJson = new Map<number, string>();
	let stopReason: unknown;
	let stopSequence: unknown;
	const usage: Record<string, unknown> = {};
	const buffer = new SseEventBuffer();

	const mergeUsage = (value: unknown): void => {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			Object.assign(usage, value);
		}
	};

	const consumePayload = (payload: Record<string, unknown>): void => {
		const type = payload["type"];
		if (type === "message_start") {
			const startedMessage = payload["message"];
			if (typeof startedMessage !== "object" || startedMessage === null || Array.isArray(startedMessage)) {
				return;
			}
			message = { ...(startedMessage as Record<string, unknown>) };
			mergeUsage(message["usage"]);
			const initialContent = message["content"];
			if (Array.isArray(initialContent)) {
				for (const [index, block] of initialContent.entries()) {
					if (typeof block === "object" && block !== null && !Array.isArray(block)) {
						content.set(index, { ...(block as Record<string, unknown>) });
					}
				}
			}
			return;
		}
		if (type === "content_block_start" && typeof payload["index"] === "number") {
			const block = payload["content_block"];
			if (typeof block === "object" && block !== null && !Array.isArray(block)) {
				content.set(payload["index"], { ...(block as Record<string, unknown>) });
			}
			return;
		}
		if (type === "content_block_delta" && typeof payload["index"] === "number") {
			const index = payload["index"];
			const delta = payload["delta"];
			const block = content.get(index);
			if (typeof delta !== "object" || delta === null || Array.isArray(delta) || !block) {
				return;
			}
			const deltaRecord = delta as Record<string, unknown>;
			if (deltaRecord["type"] === "text_delta" && typeof deltaRecord["text"] === "string") {
				block["text"] = `${String(block["text"] ?? "")}${deltaRecord["text"]}`;
			} else if (deltaRecord["type"] === "thinking_delta" && typeof deltaRecord["thinking"] === "string") {
				block["thinking"] = `${String(block["thinking"] ?? "")}${deltaRecord["thinking"]}`;
			} else if (deltaRecord["type"] === "signature_delta" && typeof deltaRecord["signature"] === "string") {
				block["signature"] = `${String(block["signature"] ?? "")}${deltaRecord["signature"]}`;
			} else if (deltaRecord["type"] === "input_json_delta" && typeof deltaRecord["partial_json"] === "string") {
				toolInputJson.set(index, `${toolInputJson.get(index) ?? ""}${deltaRecord["partial_json"]}`);
			}
			return;
		}
		if (type === "content_block_stop" && typeof payload["index"] === "number") {
			const index = payload["index"];
			const partialJson = toolInputJson.get(index);
			const block = content.get(index);
			if (partialJson !== undefined && block) {
				try {
					block["input"] = JSON.parse(partialJson);
				} catch {
					block["input"] = partialJson;
				}
			}
			return;
		}
		if (type === "message_delta") {
			const delta = payload["delta"];
			if (typeof delta === "object" && delta !== null && !Array.isArray(delta)) {
				stopReason = (delta as Record<string, unknown>)["stop_reason"];
				stopSequence = (delta as Record<string, unknown>)["stop_sequence"];
			}
			mergeUsage(payload["usage"]);
		}
	};

	const consumeEvents = (events: string[]): void => {
		for (const event of events) {
			const payload = parseResponsesSseEvent(event);
			if (payload) {
				consumePayload(payload);
			}
		}
	};

	return {
		feed: (decoded: string): void => consumeEvents(buffer.push(decoded)),
		finish: (): void => consumeEvents(buffer.flush()),
		snapshot: (): CliProxyStreamLogSnapshot | undefined => {
			if (!message && content.size === 0) {
				return undefined;
			}
			const response = {
				...(message ?? {}),
				type: message?.["type"] ?? "message",
				role: message?.["role"] ?? "assistant",
				content: [...content.entries()].sort(([left], [right]) => left - right).map(([, block]) => block),
				stop_reason: stopReason !== undefined ? stopReason : message?.["stop_reason"],
				stop_sequence: stopSequence !== undefined ? stopSequence : message?.["stop_sequence"],
				usage: { ...usage },
			};
			return { response: response, usage: normalizeNativeUsage(response.usage) };
		},
	};
}
