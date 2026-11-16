import type { Request, Response } from "express";
import { readFieldPath } from "../core/utils/contentFields";
import { markFirstContentFrame } from "../spend/FirstContentFrame";

function hasText(value: unknown): boolean {
	return typeof value === "string" && value.length > 0;
}

function hasTextAt(value: unknown, paths: readonly string[]): boolean {
	return paths.some((path) => hasText(readFieldPath(value, path)));
}

function hasContentPart(part: unknown): boolean {
	return hasText(part) || hasTextAt(part, ["text", "thinking", "refusal", "data", "url", "image_url", "image_url.url", "b64_json"]);
}

function hasContent(value: unknown): boolean {
	return Array.isArray(value) ? value.some(hasContentPart) : hasContentPart(value);
}

function choiceHasContent(choice: unknown): boolean {
	if (hasText(readFieldPath(choice, "text"))) {
		return true;
	}
	const message = readFieldPath(choice, "delta") ?? readFieldPath(choice, "message");
	if (!message || typeof message !== "object") {
		return false;
	}
	const fields = message as Record<string, unknown>;
	return (
		hasContent(fields.content) ||
		hasTextAt(fields, [
			"refusal", "reasoning_content", "reasoning", "thinking",
			"function_call.name", "function_call.arguments", "audio.data", "audio.transcript",
		]) ||
		hasContent(fields.thinking_blocks) ||
		hasContent(fields.images) ||
		hasContent(fields.image) ||
		(Array.isArray(fields.tool_calls) &&
			fields.tool_calls.some((call) => hasTextAt(call, ["function.name", "function.arguments", "custom.name", "custom.input"])))
	);
}

/**
 * Chat 与传统文本补全都用 choices 承载生成内容。角色、用量和终止标记可以单独出现。
 * @param chunk - 即将写出的补全响应或分片
 */
export function hasOpenAICompletionContent(chunk: unknown): boolean {
	if (typeof chunk === "string") {
		return chunk !== "[DONE]" && hasText(chunk);
	}
	const choices = readFieldPath(chunk, "choices");
	return Array.isArray(choices) && choices.some(choiceHasContent);
}

/**
 * 写出含内容的首帧后记录 TTFT。思考增量也属于用户已收到的内容，即使路由仍可切换候选。
 * @param req - 当前客户端请求
 * @param res - 该请求的 SSE 响应
 * @param chunk - 已按客户端协议筛选的分片
 */
export function writeOpenAICompletionChunk(req: Request, res: Response, chunk: unknown): void {
	res.write(`data: ${JSON.stringify(chunk)}\n\n`);
	if (!res.destroyed && !res.writableEnded && req.litellmFirstContentFrameAt === undefined && hasOpenAICompletionContent(chunk)) {
		markFirstContentFrame(req);
	}
}
