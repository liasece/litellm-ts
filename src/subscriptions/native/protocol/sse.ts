/**
 * Server-Sent Events 解析与编码。
 *
 * 只处理协议语义需要的字段（event/data），忽略注释、id、retry 与未知字段。
 * 解析结果保留原始 JSON 对象，非 JSON 数据（如 [DONE]）保留字符串。
 */

import type { ProtocolEvent, ProtocolPayload } from "./types";

/**
 * 把一行 data 解析为对象或原始字符串。
 * @param raw - data 字段拼接后的文本
 */
function parsePayload(raw: string): ProtocolPayload {
	const text = raw.trim();
	if (text.startsWith("{") || text.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(text);
			if (parsed && typeof parsed === "object") {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// 非法 JSON 按字符串透传，交给上层决定是否记录。
		}
	}
	return raw;
}

/**
 * 逐条读取 SSE 流。
 * @param stream - 上游响应体
 * @yields 解析后的协议事件
 */
export async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<ProtocolEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let eventName: string | undefined;
	let dataLines: string[] = [];

	const dispatch = (): ProtocolEvent | undefined => {
		if (dataLines.length === 0 && eventName === undefined) {
			return undefined;
		}
		const data = dataLines.length > 0 ? parsePayload(dataLines.join("\n")) : "";
		const event: ProtocolEvent = eventName === undefined ? { data: data } : { event: eventName, data: data };
		eventName = undefined;
		dataLines = [];
		return event;
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode();
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex >= 0) {
				let line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (line.endsWith("\r")) {
					line = line.slice(0, -1);
				}
				if (line === "") {
					const event = dispatch();
					if (event !== undefined) {
						yield event;
					}
				} else if (!line.startsWith(":")) {
					const colon = line.indexOf(":");
					const field = colon >= 0 ? line.slice(0, colon) : line;
					let valuePart = colon >= 0 ? line.slice(colon + 1) : "";
					if (valuePart.startsWith(" ")) {
						valuePart = valuePart.slice(1);
					}
					if (field === "event") {
						eventName = valuePart;
					} else if (field === "data") {
						dataLines.push(valuePart);
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}
		}
		if (buffer.length > 0) {
			const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
			if (line.startsWith("data:")) {
				let valuePart = line.slice(5);
				if (valuePart.startsWith(" ")) {
					valuePart = valuePart.slice(1);
				}
				dataLines.push(valuePart);
			}
		}
		const tail = dispatch();
		if (tail !== undefined) {
			yield tail;
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * 编码一条 SSE 事件。
 * @param event - 协议事件
 * @param includeEventName - 是否写出 event: 字段
 */
export function encodeSseEvent(event: ProtocolEvent, includeEventName: boolean): string {
	const lines: string[] = [];
	if (includeEventName && event.event) {
		lines.push(`event: ${event.event}`);
	}
	const payload =
		typeof event.data === "string" ? event.data : JSON.stringify(event.data);
	for (const line of payload.split("\n")) {
		lines.push(`data: ${line}`);
	}
	return `${lines.join("\n")}\n\n`;
}

/**
 * 判断响应是否以 SSE 形式返回。
 * @param response - 上游响应
 */
export function isSseResponse(response: Response): boolean {
	const contentType = response.headers.get("content-type") ?? "";
	return contentType.toLowerCase().includes("text/event-stream");
}
