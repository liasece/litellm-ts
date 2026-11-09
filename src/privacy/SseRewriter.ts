/**
 * SSE 帧级还原器。
 *
 * 网关的推理响应基本都是 SSE：要么在进程内重新序列化（Chat / Completions /
 * Messages / Responses），要么整段透传上游字节（CLIProxy 原生协议）。两种来源
 * 都可能把同一个占位符切到多个 `data:` 帧里，因此这里按「帧」而不是按「HTTP 分块」
 * 处理：解析出协议形状，只改内容增量字段，其余字段与未知帧原样透传。
 *
 * 无法识别的帧（keepalive、ping、雨棚填充、厂商私有事件）一律原样输出；
 * 带签名的 thinking 增量不做还原，保证下一轮签名校验不会失败。
 */
import type { PlaceholderRestorer } from "./PlaceholderRestorer";

/** 识别出的协议形状 */
type SseProtocol = "chat" | "anthropic" | "responses" | "completions" | "unknown";

/** 帧分隔符匹配结果 */
interface FrameSplit {
	/** 帧体结束位置 */
	readonly index: number;
	/** 实际分隔符（保留原始换行风格） */
	readonly separator: string;
}

/**
 * 在缓冲区里寻找帧边界。
 * @param buffer - SSE 缓冲区
 */
function findFrameBoundary(buffer: string): FrameSplit | null {
	const lineFeed = buffer.indexOf("\n\n");
	const carriage = buffer.indexOf("\r\n\r\n");
	if (lineFeed < 0 && carriage < 0) {
		return null;
	}
	if (carriage >= 0 && (lineFeed < 0 || carriage < lineFeed)) {
		return { index: carriage, separator: "\r\n\r\n" };
	}
	return { index: lineFeed, separator: "\n\n" };
}

/**
 * 判断一个已解析的 JSON 载荷属于哪种协议。
 * @param payload - 事件载荷
 */
function detectProtocol(payload: Record<string, unknown>): SseProtocol {
	const type = typeof payload["type"] === "string" ? payload["type"] : "";
	if (type.startsWith("content_block_") || type === "message_start" || type === "message_delta" || type === "message_stop") {
		return "anthropic";
	}
	if (type.startsWith("response.")) {
		return "responses";
	}
	const choices = payload["choices"];
	if (Array.isArray(choices)) {
		const first = choices[0];
		if (typeof first === "object" && first !== null) {
			const record = first as Record<string, unknown>;
			if (typeof record["delta"] === "object" && record["delta"] !== null) {
				return "chat";
			}
			if (typeof record["text"] === "string") {
				return "completions";
			}
		}
	}
	return "unknown";
}

/**
 * 读取普通对象。
 * @param value - 待判断的值
 */
function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** SSE 还原器 */
export class SseRewriter {
	private readonly _restorer: PlaceholderRestorer;
	private _buffer = "";
	private readonly _frameBuilders = new Map<string, (text: string) => string>();

	/**
	 * @param restorer - 占位符还原器
	 */
	constructor(restorer: PlaceholderRestorer) {
		this._restorer = restorer;
	}

	/**
	 * 处理一段新增字节，返回应当立即写出的内容。
	 * @param text - 新增文本
	 */
	push(text: string): string {
		this._buffer += text;
		let output = "";
		let boundary = findFrameBoundary(this._buffer);
		while (boundary !== null) {
			const frame = this._buffer.slice(0, boundary.index);
			this._buffer = this._buffer.slice(boundary.index + boundary.separator.length);
			output += this._rewriteFrame(frame) + boundary.separator;
			boundary = findFrameBoundary(this._buffer);
		}
		return output;
	}

	/**
	 * 结束流：把扣住的字符补成增量帧，再输出未成帧的残留字节。
	 */
	finish(): string {
		const flushed = this._flushAllCarries();
		const tail = this._buffer;
		this._buffer = "";
		return flushed + tail;
	}

	/**
	 * 判断当前是否还有被扣住的字符。
	 */
	hasPending(): boolean {
		return this._restorer.hasPending;
	}

	/**
	 * 重写单帧。
	 * @param frame - 不含分隔符的帧体
	 */
	private _rewriteFrame(frame: string): string {
		if (frame.trim().length === 0) {
			return frame;
		}
		const lines = frame.split(/\r?\n/);
		let eventName = "";
		const dataParts: string[] = [];
		for (const line of lines) {
			if (line.startsWith("event:")) {
				eventName = line.slice(6).trim();
				continue;
			}
			if (line.startsWith("data:")) {
				const value = line.slice(5);
				dataParts.push(value.startsWith(" ") ? value.slice(1) : value);
			}
		}
		if (dataParts.length === 0) {
			return frame;
		}
		const data = dataParts.join("\n");
		if (data.trim() === "[DONE]") {
			return this._flushAllCarries() + frame;
		}
		let payload: Record<string, unknown> | null = null;
		try {
			payload = asRecord(JSON.parse(data));
		} catch {
			payload = null;
		}
		if (payload === null) {
			return frame;
		}
		const protocol = detectProtocol(payload);
		const type = typeof payload["type"] === "string" ? payload["type"] : "";
		const prefix = this._beforeFrame(protocol, type, eventName, payload);
		const changed = this._rewritePayload(protocol, payload);
		if (!changed && prefix.length === 0) {
			return frame;
		}
		if (!changed) {
			return prefix + frame;
		}
		const json = JSON.stringify(payload);
		const head = eventName.length > 0 ? `event: ${eventName}\n` : "";
		const rebuilt = `${head}data: ${json}`;
		return prefix + rebuilt;
	}

	/**
	 * 终态帧与块结束帧之前，先把对应内容流扣住的字符补发出去。
	 * @param protocol - 协议
	 * @param type - 事件类型
	 * @param eventName - 原始事件名
	 * @param payload - 事件载荷
	 */
	private _beforeFrame(protocol: SseProtocol, type: string, eventName: string, payload: Record<string, unknown>): string {
		if (type === "message_stop") {
			return this._flushAllCarries();
		}
		if (type === "response.completed" || type === "response.incomplete" || type === "response.failed" || type === "error") {
			return this._flushAllCarries();
		}
		if (protocol === "anthropic" && type === "content_block_stop") {
			const index = typeof payload["index"] === "number" ? payload["index"] : 0;
			return this._flushKey(`a:${index}:text`) + this._flushKey(`a:${index}:json`);
		}
		if (protocol === "responses" && type === "response.output_text.done") {
			const itemId = typeof payload["item_id"] === "string" ? payload["item_id"] : "";
			if (itemId.length > 0) {
				return this._flushKey(`r:${itemId}:text`);
			}
		}
		void eventName;
		return "";
	}

	/**
	 * 按协议改写载荷，返回是否发生变化。
	 * @param protocol - 协议
	 * @param payload - 事件载荷（就地修改）
	 */
	private _rewritePayload(protocol: SseProtocol, payload: Record<string, unknown>): boolean {
		switch (protocol) {
			case "chat":
				return this._rewriteChat(payload);
			case "completions":
				return this._rewriteCompletions(payload);
			case "anthropic":
				return this._rewriteAnthropic(payload);
			case "responses":
				return this._rewriteResponses(payload);
			case "unknown":
				return this._rewriteUnknown(payload);
			default:
				return false;
		}
	}

	/**
	 * OpenAI Chat 增量。
	 * @param payload - 事件载荷
	 */
	private _rewriteChat(payload: Record<string, unknown>): boolean {
		const choices = payload["choices"];
		if (!Array.isArray(choices)) {
			return false;
		}
		let changed = false;
		for (let position = 0; position < choices.length; position++) {
			const choice = asRecord(choices[position]);
			if (choice === null) {
				continue;
			}
			const index = typeof choice["index"] === "number" ? choice["index"] : position;
			const delta = asRecord(choice["delta"]);
			if (delta !== null) {
				changed = this._rewriteChatDelta(index, delta, payload) || changed;
			}
			const message = asRecord(choice["message"]);
			if (message !== null) {
				changed = this._rewriteChatMessage(index, message) || changed;
			}
		}
		return changed;
	}

	/**
	 * Chat 增量字段：正文、推理正文与工具参数。
	 * @param index - choice 下标
	 * @param delta - 增量对象
	 * @param payload - 帧载荷（用于构造补发帧）
	 */
	private _rewriteChatDelta(index: number, delta: Record<string, unknown>, payload: Record<string, unknown>): boolean {
		let changed = false;
		const content = delta["content"];
		if (typeof content === "string" && content.length > 0) {
			const restored = this._restorer.restoreStreaming(`c:${index}:content`, content);
			if (restored !== content) {
				delta["content"] = restored;
				changed = true;
			}
			this._frameBuilders.set(`c:${index}:content`, (text: string) => this._buildChatFrame(payload, index, text));
		}
		for (const field of ["reasoning_content", "reasoning"]) {
			const value = delta[field];
			if (typeof value === "string" && value.length > 0) {
				const restored = this._restorer.restoreStreaming(`c:${index}:${field}`, value);
				if (restored !== value) {
					delta[field] = restored;
					changed = true;
				}
			}
		}
		const toolCalls = delta["tool_calls"];
		if (Array.isArray(toolCalls)) {
			for (let position = 0; position < toolCalls.length; position++) {
				const call = asRecord(toolCalls[position]);
				const fn = asRecord(call?.["function"]);
				const args = fn?.["arguments"];
				if (typeof args !== "string" || args.length === 0) {
					continue;
				}
				const callIndex = typeof call?.["index"] === "number" ? (call["index"] as number) : position;
				const restored = this._restorer.restoreStreaming(`c:${index}:tc:${callIndex}`, args);
				if (restored !== args) {
					fn!["arguments"] = restored;
					changed = true;
				}
			}
		}
		return changed;
	}

	/**
	 * Chat 非流式消息（部分厂商会在 SSE 里直接给整段 message）。
	 * @param index - choice 下标
	 * @param message - message 对象
	 */
	private _rewriteChatMessage(index: number, message: Record<string, unknown>): boolean {
		let changed = false;
		const content = message["content"];
		if (typeof content === "string" && content.length > 0) {
			const restored = this._restorer.restoreStreaming(`c:${index}:content`, content);
			if (restored !== content) {
				message["content"] = restored;
				changed = true;
			}
		}
		const toolCalls = message["tool_calls"];
		if (Array.isArray(toolCalls)) {
			for (const item of toolCalls) {
				const call = asRecord(item);
				const fn = asRecord(call?.["function"]);
				const args = fn?.["arguments"];
				if (typeof args !== "string") {
					continue;
				}
				const restored = this._restorer.restoreDocument(args);
				if (restored !== args) {
					fn!["arguments"] = restored;
					changed = true;
				}
			}
		}
		return changed;
	}

	/**
	 * Chat 补发帧：沿用原帧骨架，只替换 content 增量。
	 * @param payload - 原帧载荷
	 * @param index - choice 下标
	 * @param text - 补发文本
	 */
	private _buildChatFrame(payload: Record<string, unknown>, index: number, text: string): string {
		const base: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(payload)) {
			if (key !== "choices") {
				base[key] = value;
			}
		}
		const choices = Array.isArray(payload["choices"]) ? (payload["choices"] as unknown[]) : [];
		const skeleton = asRecord(choices[0]) ?? {};
		const rebuilt: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(skeleton)) {
			if (key !== "delta") {
				rebuilt[key] = value;
			}
		}
		rebuilt["index"] = index;
		rebuilt["delta"] = { content: text };
		base["choices"] = [rebuilt];
		return `data: ${JSON.stringify(base)}`;
	}

	/**
	 * Completions 增量。
	 * @param payload - 事件载荷
	 */
	private _rewriteCompletions(payload: Record<string, unknown>): boolean {
		const choices = payload["choices"];
		if (!Array.isArray(choices)) {
			return false;
		}
		let changed = false;
		for (let position = 0; position < choices.length; position++) {
			const choice = asRecord(choices[position]);
			if (choice === null) {
				continue;
			}
			const index = typeof choice["index"] === "number" ? choice["index"] : position;
			const text = choice["text"];
			if (typeof text !== "string" || text.length === 0) {
				continue;
			}
			const restored = this._restorer.restoreStreaming(`cmp:${index}`, text);
			if (restored !== text) {
				choice["text"] = restored;
				changed = true;
			}
		}
		return changed;
	}

	/**
	 * Anthropic Messages 增量。
	 * @param payload - 事件载荷
	 */
	private _rewriteAnthropic(payload: Record<string, unknown>): boolean {
		const type = typeof payload["type"] === "string" ? payload["type"] : "";
		const index = typeof payload["index"] === "number" ? payload["index"] : 0;
		if (type === "content_block_delta") {
			const delta = asRecord(payload["delta"]);
			if (delta === null) {
				return false;
			}
			const deltaType = typeof delta["type"] === "string" ? delta["type"] : "";
			if (deltaType === "text_delta" && typeof delta["text"] === "string") {
				const original = delta["text"];
				const restored = this._restorer.restoreStreaming(`a:${index}:text`, original);
				if (restored === original) {
					return false;
				}
				delta["text"] = restored;
				this._frameBuilders.set(`a:${index}:text`, (text: string) =>
					this._buildAnthropicFrame(index, { type: "text_delta", text: text }),
				);
				return true;
			}
			if (deltaType === "input_json_delta" && typeof delta["partial_json"] === "string") {
				const original = delta["partial_json"];
				const restored = this._restorer.restoreStreaming(`a:${index}:json`, original);
				if (restored === original) {
					return false;
				}
				delta["partial_json"] = restored;
				this._frameBuilders.set(`a:${index}:json`, (text: string) =>
					this._buildAnthropicFrame(index, { type: "input_json_delta", partial_json: text }),
				);
				return true;
			}
			// thinking_delta / signature_delta / citations_delta：签名覆盖上游字节，原样透传
			return false;
		}
		if (type === "content_block_start") {
			const block = asRecord(payload["content_block"]);
			if (block === null) {
				return false;
			}
			const blockType = typeof block["type"] === "string" ? block["type"] : "";
			if (blockType === "tool_use") {
				const input = block["input"];
				if (input !== undefined) {
					block["input"] = this._restorer.restoreDeep(input);
					return true;
				}
			}
			if (blockType === "text" && typeof block["text"] === "string" && block["text"].length > 0) {
				const original = block["text"];
				block["text"] = this._restorer.restoreDocument(original);
				return block["text"] !== original;
			}
			return false;
		}
		if (type === "message_start") {
			const message = asRecord(payload["message"]);
			if (message === null || !Array.isArray(message["content"])) {
				return false;
			}
			const before = JSON.stringify(message["content"]);
			message["content"] = this._restorer.restoreDeep(message["content"]);
			return JSON.stringify(message["content"]) !== before;
		}
		if (type === "error") {
			const error = asRecord(payload["error"]);
			if (error !== null && typeof error["message"] === "string") {
				const original = error["message"];
				error["message"] = this._restorer.restoreDocument(original);
				return error["message"] !== original;
			}
		}
		return false;
	}

	/**
	 * 构造 Anthropic 补发帧。
	 * @param index - 内容块下标
	 * @param delta - 增量对象
	 */
	private _buildAnthropicFrame(index: number, delta: Record<string, unknown>): string {
		const payload = { type: "content_block_delta", index: index, delta: delta };
		return `event: content_block_delta\ndata: ${JSON.stringify(payload)}`;
	}

	/**
	 * Responses API 增量。
	 * @param payload - 事件载荷
	 */
	private _rewriteResponses(payload: Record<string, unknown>): boolean {
		const type = typeof payload["type"] === "string" ? payload["type"] : "";
		const itemId = typeof payload["item_id"] === "string" ? payload["item_id"] : "";
		if (type === "response.output_text.delta" || type === "response.refusal.delta") {
			const delta = payload["delta"];
			if (typeof delta !== "string" || delta.length === 0) {
				return false;
			}
			const suffix = type === "response.refusal.delta" ? "refusal" : "text";
			const key = `r:${itemId}:${suffix}`;
			const restored = this._restorer.restoreStreaming(key, delta);
			if (restored === delta) {
				return false;
			}
			payload["delta"] = restored;
			this._frameBuilders.set(key, (text: string) => this._buildResponsesFrame(payload, text));
			return true;
		}
		if (type === "response.function_call_arguments.delta") {
			const delta = payload["delta"];
			if (typeof delta !== "string" || delta.length === 0) {
				return false;
			}
			const key = `r:${itemId}:args`;
			const restored = this._restorer.restoreStreaming(key, delta);
			if (restored === delta) {
				return false;
			}
			payload["delta"] = restored;
			return true;
		}
		if (type === "response.reasoning_summary_text.delta") {
			const delta = payload["delta"];
			if (typeof delta !== "string" || delta.length === 0) {
				return false;
			}
			const key = `r:${itemId}:summary`;
			const restored = this._restorer.restoreStreaming(key, delta);
			if (restored === delta) {
				return false;
			}
			payload["delta"] = restored;
			return true;
		}
		if (type === "response.output_text.done" || type === "response.function_call_arguments.done") {
			const field = type === "response.output_text.done" ? "text" : "arguments";
			const value = payload[field];
			if (typeof value !== "string" || value.length === 0) {
				return false;
			}
			const key = type === "response.output_text.done" ? `r:${itemId}:text` : `r:${itemId}:args`;
			const carry = this._restorer.takePending(key);
			const restored = this._restorer.restoreDocument(`${carry}${value}`);
			payload[field] = restored;
			return restored !== value;
		}
		if (type === "response.output_item.added" || type === "response.output_item.done") {
			const item = payload["item"];
			if (item === undefined) {
				return false;
			}
			const before = JSON.stringify(item);
			payload["item"] = this._restorer.restoreDeep(item);
			return JSON.stringify(payload["item"]) !== before;
		}
		if (type === "response.completed" || type === "response.incomplete") {
			const response = payload["response"];
			if (response === undefined) {
				return false;
			}
			const before = JSON.stringify(response);
			payload["response"] = this._restorer.restoreDeep(response);
			return JSON.stringify(payload["response"]) !== before;
		}
		if (type === "response.reasoning_summary_part.added" || type === "response.reasoning_summary_text.done") {
			const part = asRecord(payload["part"]);
			if (part !== null && typeof part["text"] === "string") {
				const original = part["text"];
				part["text"] = this._restorer.restoreDocument(original);
				return part["text"] !== original;
			}
		}
		return false;
	}

	/**
	 * 构造 Responses 补发帧。
	 * @param payload - 原帧载荷
	 * @param text - 补发文本
	 */
	private _buildResponsesFrame(payload: Record<string, unknown>, text: string): string {
		const rebuilt: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(payload)) {
			if (key !== "delta") {
				rebuilt[key] = value;
			}
		}
		rebuilt["delta"] = text;
		const eventName = typeof rebuilt["type"] === "string" ? rebuilt["type"] : "response.output_text.delta";
		return `event: ${eventName}\ndata: ${JSON.stringify(rebuilt)}`;
	}

	/**
	 * 未知帧：只在能整段还原时改写（不处理跨帧拆分）。
	 * @param payload - 事件载荷
	 */
	private _rewriteUnknown(payload: Record<string, unknown>): boolean {
		const before = JSON.stringify(payload);
		const restored = this._restorer.restoreDeep(payload);
		return JSON.stringify(restored) !== before;
	}

	/**
	 * 补发某个内容流被扣住的字符。
	 * @param key - 内容流标识
	 */
	private _flushKey(key: string): string {
		const builder = this._frameBuilders.get(key);
		const pending = this._restorer.takePending(key);
		if (pending.length === 0 || builder === undefined) {
			return "";
		}
		return `${builder(pending)}\n\n`;
	}

	/**
	 * 补发所有内容流被扣住的字符。
	 */
	private _flushAllCarries(): string {
		let output = "";
		for (const entry of this._restorer.pendingEntries()) {
			output += this._flushKey(entry.key);
		}
		return output;
	}
}
