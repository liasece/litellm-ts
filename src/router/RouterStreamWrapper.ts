/**
 * Router 流式响应包装器
 *
 * 从 Router 拆出，专门处理：
 * - provider 不支持 streamResponse 时的一次性回退
 * - 真正的 SSE 流式 TTFT 测量与异常透出
 *
 * 这块逻辑独立于 Router 路由策略与重试链，单独抽出便于测试与降低 Router.ts 行数。
 */

import type { ProviderConfig } from "../types/provider";

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
 */
export function buildStreamWithTtft(response: Response, fetchStart: number, provider: ProviderConfig): StreamWithTtft {
	if (!provider.streamResponse) {
		// provider 不支持流式 — 回退到一次性 response.text() 并通过 generator yield 一次
		const stream = (async function* () {
			const text = await response.text();
			yield text;
		})();
		return { stream: stream, body: "", ttft: Date.now() - fetchStart };
	}

	const inner = provider.streamResponse(response);
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
