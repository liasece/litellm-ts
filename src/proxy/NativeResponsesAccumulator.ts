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
		if (this._text !== "") {
			output.push({
				type: "message",
				role: "assistant",
				status: "in_progress",
				content: [{ type: "output_text", text: this._text }],
			});
		}
		if (this._reasoning !== "") {
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
 * 把任意值收窄为对象记录。
 * @param value - 任意待收窄值
 */
export function asResponseRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}
