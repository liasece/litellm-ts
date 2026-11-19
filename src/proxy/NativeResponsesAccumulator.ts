/**
 * 原生 Responses 协议流的中间响应累积器。
 *
 * 透传端点与兼容端点共用同一份累积逻辑：只有这样才能保证"进行中看到的形状"与
 * "最终落库的形状"一致，日志详情页不必为两条路径各写一套渲染。
 */

/**
 * 判断值是否为非数组对象。
 * @param value - 任意待判定值
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const responseContentFields = new Map<string, string>([
	["response.output_text", "text"],
	["response.reasoning_text", "text"],
	["response.reasoning_summary_text", "text"],
	["response.refusal", "refusal"],
	["response.function_call_arguments", "arguments"],
	["response.custom_tool_call_input", "input"],
]);

function nonEmpty(value: unknown): boolean {
	return typeof value === "string" && value.length > 0;
}

function hasResponsePartContent(part: unknown): boolean {
	return isRecord(part) && (nonEmpty(part["text"]) || nonEmpty(part["refusal"]));
}

function hasResponseItemContent(item: unknown): boolean {
	if (!isRecord(item)) {
		return false;
	}
	const kind = item["type"];
	return (
		((kind === "function_call" || kind === "custom_tool_call" || kind === "mcp_call") && nonEmpty(item["name"])) ||
		(Array.isArray(item["content"]) && item["content"].some(hasResponsePartContent)) ||
		(Array.isArray(item["summary"]) && item["summary"].some(hasResponsePartContent)) ||
		nonEmpty(item["arguments"]) ||
		nonEmpty(item["input"]) ||
		nonEmpty(item["result"])
	);
}

/**
 * Some providers send a complete item without deltas. Its content is observable on the
 * wire just like a delta; an empty item, lifecycle event or usage summary has no TTFT.
 * @param event - Responses event written to an HTTP or WebSocket client
 */
export function hasNativeResponsesContent(event: Record<string, unknown>): boolean {
	const type = event["type"];
	if (typeof type !== "string") {
		return false;
	}
	if (type === "response.output_item.added" || type === "response.output_item.done") {
		return hasResponseItemContent(event["item"]);
	}
	if (type === "response.content_part.added" || type === "response.content_part.done") {
		return hasResponsePartContent(event["part"]);
	}
	if (type === "response.image_generation_call.partial_image" || type === "response.image_generation_call.completed") {
		return nonEmpty(event["partial_image_b64"]) || nonEmpty(event["result"]);
	}
	if (type === "response.completed" || type === "response.incomplete") {
		const response = event["response"];
		return isRecord(response) && Array.isArray(response["output"]) && response["output"].some(hasResponseItemContent);
	}
	const split = type.lastIndexOf(".");
	const field = responseContentFields.get(type.slice(0, split));
	if (!field) {
		return false;
	}
	const suffix = type.slice(split + 1);
	return (suffix === "delta" && nonEmpty(event["delta"])) || (suffix === "done" && nonEmpty(event[field]));
}

/**
 * 累积标准 output item 结构，供流式进行中的 checkpoint 产出可展示的部分 response。
 *
 * 对齐 CLIProxy `extractNativeResponse` 的 partial 思路，但事件级累积不依赖整段原始
 * SSE（长流会被截断），因此进行中与终态都能拿到同一套 output item。
 */
export class NativeResponsesAccumulator {
	private _id?: string;
	private _model?: string;
	private _output: Record<string, unknown>[] = [];
	private _text = "";
	private _reasoning = "";
	private _usage: Record<string, unknown> | undefined;
	/** 上游终态事件里的完整响应；审计行按它保存真实上游响应，而不是下游映射结果。 */
	private _finalResponse: Record<string, unknown> | undefined;

	/**
	 * 吃进一条 Responses SSE 事件。
	 * @param event - 已解析的事件负载
	 */
	accumulate(event: Record<string, unknown>): void {
		const type = typeof event["type"] === "string" ? event["type"] : "";
		if (type === "response.created" || type === "response.in_progress") {
			const response = asResponseRecord(event["response"]);
			if (response) {
				this._id ??= typeof response["id"] === "string" ? response["id"] : undefined;
				this._model ??= typeof response["model"] === "string" ? response["model"] : undefined;
				if (Array.isArray(response["output"])) {
					this._output = response["output"].filter(isRecord).map((item) => structuredClone(item));
				}
			}
		} else if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
			this._text += event["delta"];
		} else if (type === "response.output_text.done" && typeof event["text"] === "string") {
			this._text = event["text"];
		} else if (type === "response.reasoning_text.delta" && typeof event["delta"] === "string") {
			this._reasoning += event["delta"];
		} else if (type === "response.output_item.done") {
			const item = asResponseRecord(event["item"]);
			if (item) {
				this._output.push(structuredClone(item));
			}
		} else if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
			const response = asResponseRecord(event["response"]);
			if (response) {
				this._finalResponse = structuredClone(response);
				this._id = typeof response["id"] === "string" ? response["id"] : this._id;
				this._model = typeof response["model"] === "string" ? response["model"] : this._model;
				if (Array.isArray(response["output"])) {
					this._output = response["output"].filter(isRecord).map((item) => structuredClone(item));
				}
				const usage = asResponseRecord(response["usage"]);
				if (usage) {
					this._usage = structuredClone(usage);
				}
			}
		}
	}

	/**
	 * 上游终态事件携带的完整响应对象。
	 *
	 * 用于把「实际收到的上游响应」写进内部调用的审计行；映射成 chat 的 `snapshot()`
	 * 是网关内部视图，不能当作上游响应保存。
	 */
	finalResponse(): Record<string, unknown> | undefined {
		return this._finalResponse === undefined ? undefined : structuredClone(this._finalResponse);
	}

	/**
	 * 产出当前可展示的部分响应；尚无任何内容时返回 null。
	 */
	snapshot(): Record<string, unknown> | null {
		if (
			this._id === undefined &&
			this._model === undefined &&
			this._output.length === 0 &&
			this._text === "" &&
			this._reasoning === ""
		) {
			return null;
		}
		const output = [...this._output];
		// 上游通常既发增量、又在 output item/completed 里给出完整内容；两者描述同一段
		// 文本，只有一个来源时才补合成 item，否则审计与映射结果会把文本拼两遍。
		if (this._text !== "" && !output.some((item) => messageTextOf(item).length > 0)) {
			output.push({
				type: "message",
				role: "assistant",
				status: "in_progress",
				content: [{ type: "output_text", text: this._text }],
			});
		}
		if (this._reasoning !== "" && !output.some((item) => reasoningTextOf(item).length > 0)) {
			output.push({
				type: "reasoning",
				content: [{ type: "reasoning_text", text: this._reasoning }],
			});
		}
		return {
			id: this._id ?? "",
			object: "response",
			status: "in_progress",
			model: this._model,
			output: output,
			usage: this._usage ?? null,
		};
	}
}

/**
 * 读取 message item 已携带的文本，用于判断增量文本是否已被 item 覆盖。
 * @param item - output item
 */
function messageTextOf(item: Record<string, unknown>): string {
	if (item["type"] !== "message" || !Array.isArray(item["content"])) {
		return "";
	}
	return (item["content"] as Array<Record<string, unknown>>)
		.filter((part) => part !== null && typeof part === "object" && (part["type"] === "output_text" || part["type"] === "text"))
		.map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
		.join("");
}

/**
 * 读取 reasoning item 已携带的文本（content 或 summary）。
 * @param item - output item
 */
function reasoningTextOf(item: Record<string, unknown>): string {
	if (item["type"] !== "reasoning") {
		return "";
	}
	return [...(Array.isArray(item["content"]) ? item["content"] : []), ...(Array.isArray(item["summary"]) ? item["summary"] : [])]
		.filter((part) => part !== null && typeof part === "object" && typeof (part as Record<string, unknown>)["text"] === "string")
		.map((part) => (part as Record<string, unknown>)["text"] as string)
		.join("");
}

/**
 * 把任意值收窄为对象记录。
 * @param value - 任意待收窄值
 */
export function asResponseRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}
