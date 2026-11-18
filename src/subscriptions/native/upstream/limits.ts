/**
 * 请求侧的上游输出上限校验。
 *
 * 为什么要做：glm-5.3 的上游上限是 131072，但 OpenAI 兼容客户端常按「上下文的一半」
 * 或模型默认值填 `max_output_tokens`（观察到的真实请求是 384000）。上游只会回一个
 * 笼统的 `400 invalid_request`，调用方无法判断是自己填错了还是代理的问题。这里在上游
 * 之前拦下，用一条能直接照做的错误说明上限来自哪里。
 *
 * 约束：只用内存里的上游元信息。缓存没命中（或该上游不提供输出上限）时放行，绝不为了
 * 校验去等上游——校验不能变成新的阻塞点。
 */

import { ApiError } from "../../../core/api/ApiError";
import { asNumber, asRecord } from "./normalize";
import { upstreamMetadataFor } from "./runtime";
import type { SubscriptionSource } from "../types";

/** 各入站协议里表示「最大输出」的字段。 */
const OUTPUT_LIMIT_FIELDS = ["max_output_tokens", "max_completion_tokens", "max_tokens", "maxOutputTokens"] as const;

/**
 * 从请求体里取调用方要求的最多输出 token。
 * @param body - 入站请求体
 * @returns 找到的第一个数值；没有则 undefined
 */
export function requestedMaxOutputTokens(body: Record<string, unknown>): number | undefined {
	for (const key of OUTPUT_LIMIT_FIELDS) {
		const value = asNumber(body[key]);
		if (value !== undefined) {
			return value;
		}
	}
	// Gemini 入站把上限写在 generationConfig.maxOutputTokens。
	const generationConfig = asRecord(body["generationConfig"]);
	return asNumber(generationConfig?.["maxOutputTokens"]);
}

/**
 * 超过上游输出上限时抛出可读的 400。
 * @param source - 订阅来源
 * @param upstreamModel - 上游模型 ID
 * @param body - 入站请求体
 * @throws {ApiError} 请求声明的输出上限高于缓存里的上游上限
 */
export function assertWithinUpstreamOutputLimit(source: SubscriptionSource, upstreamModel: string, body: Record<string, unknown>): void {
	const limit = upstreamMetadataFor(source, upstreamModel)?.maxOutputTokens;
	const requested = requestedMaxOutputTokens(body);
	if (limit === undefined || requested === undefined || requested <= limit) {
		return;
	}
	throw ApiError.badRequest(
		`请求的输出上限 max_output_tokens=${requested} 超过模型 ${upstreamModel} 的上游上限 ${limit}（来源 ${source}）。` +
			`请把 max_output_tokens 调到 ${limit} 或以下；上游信息每 4 小时自动刷新。`,
	);
}
