/**
 * Router 流式响应包装器
 *
 * 从 Router 拆出，专门处理：
 * - provider 不支持 streamResponse 时的一次性回退
 * - 真正的 SSE 流式 TTFT 测量与异常透出
 *
 * 这块逻辑独立于 Router 路由策略与重试链，单独抽出便于测试与降低 Router.ts 行数。
 */

import type { ProviderConfig, ProviderResponseProtocol } from "../types/provider";

/** 包装后的 stream 结果 */
export interface StreamWithTtft {
	/** SSE chunk 异步迭代器 */
	stream: AsyncGenerator<unknown>;
	/** 降级 body（仅当 provider 不支持 streamResponse 时给出，否则 undefined） */
	body: unknown;
	/** TTFT (ms)：第一个 chunk yield 时刻 - fetchStart；未消费时退回总耗时 */
	ttft: number;
}

/**
 * 构建带 TTFT 测量的流式响应。
 *
 * 设计要点：
 * 1. provider.streamResponse 不存在 → 一次性 `response.text()` 单 yield 兜底，
 *    TTFT 取总耗时。
 * 2. provider.streamResponse 存在 → wrap 异步迭代器，在第一个 chunk 时刻
 *    记录 firstChunkAt；TTFT = firstChunkAt - fetchStart。
 * 3. 内部迭代异常作为最后一个 chunk `{ error }` 透出，避免直接抛中断调用方循环。
 * @param response - fetch Response
 * @param fetchStart - fetch 调用开始时间（ms epoch）
 * @param provider - ProviderConfig（提供 streamResponse 时走真流路径）
 * @param responseProtocol - 上游响应协议；Responses 使用语义 SSE 解析
 */
export function buildStreamWithTtft(
	response: Response,
	fetchStart: number,
	provider: ProviderConfig,
	responseProtocol: ProviderResponseProtocol = "chat_completions",
): StreamWithTtft {
	if (responseProtocol === "responses") {
		return wrapStreamWithTtft(streamResponsesSse(response), fetchStart);
	}
	if (!provider.streamResponse) {
		// provider 不支持流式 — 回退到一次性 response.text() 并通过 generator yield 一次
		const stream = (async function* () {
			const text = await response.text();
			yield text;
		})();
		return { stream: stream, body: "", ttft: Date.now() - fetchStart };
	}

	return wrapStreamWithTtft(provider.streamResponse(response), fetchStart);
}

function wrapStreamWithTtft(inner: AsyncGenerator<unknown>, fetchStart: number): StreamWithTtft {
	let firstChunkAt: number | null = null;
	const wrapped = (async function* () {
		try {
			for await (const chunk of inner) {
				if (firstChunkAt === null) {
					firstChunkAt = Date.now();
				}
				yield chunk;
			}
		} catch (err) {
			// 流式读取出错时把错误作为最后一个 chunk 透出
			yield { error: (err as Error).message };
		}
	})();
	// 第一次 yield 时记录精确 TTFT；此刻返回 estimated 值，
	// 若调用方从未消费 stream 也会用整次响应耗时兜底。
	return {
		stream: wrapped,
		body: undefined,
		ttft: firstChunkAt !== null ? firstChunkAt - fetchStart : Date.now() - fetchStart,
	};
}

/**
 * 解析 OpenAI Responses 语义 SSE。`event:` 仅用于 framing，真实事件类型以
 * JSON payload 的 `type` 为准；DeepSeek keep-alive 注释会被忽略。
 * @param response - 上游 fetch Response
 * @yields 解析后的 Responses 语义事件
 */
async function* streamResponsesSse(response: Response): AsyncGenerator<Record<string, unknown>> {
	const reader = response.body?.getReader();
	if (!reader) {
		return;
	}
	const decoder = new TextDecoder();
	let buffer = "";

	const parseFrame = (frame: string): Record<string, unknown> | undefined => {
		const dataLines = frame
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart());
		if (dataLines.length === 0) {
			return undefined;
		}
		const payload = dataLines.join("\n").trim();
		if (payload.length === 0 || payload === "[DONE]") {
			return undefined;
		}
		const parsed = JSON.parse(payload) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("Provider 返回 malformed Responses SSE event");
		}
		return parsed as Record<string, unknown>;
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				const frame = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const event = parseFrame(frame);
				if (event) {
					yield event;
				}
				boundary = buffer.indexOf("\n\n");
			}
			if (done) {
				const event = parseFrame(buffer);
				if (event) {
					yield event;
				}
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
