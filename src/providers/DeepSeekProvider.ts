/**
 * DeepSeek Provider
 *
 * 在 OpenAI 兼容格式之上添加 DeepSeek 特有的消息规范化：
 *   - Patch 4: 拆分 assistant 中交错的 tool_use/tool_result，tool_result 移至下一条 user 消息
 *   - Patch 5: 为无 thinking 块的 assistant 消息注入空 thinking 块
 *
 * 参考: litellm Python litellm/llms/anthropic/experimental_pass_through/messages/handler.py
 */

import { OpenAICompatProvider } from "./OpenAICompatProvider";
import type { ProviderRequest } from "../types/provider";
import type { Message } from "../types/openai";

/**
 * DeepSeek 提供商
 *
 * 在 OpenAI 兼容格式之上添加 DeepSeek 特有的消息规范化处理。
 */
export class DeepSeekProvider extends OpenAICompatProvider {
	constructor(apiKey = "", apiBase = "https://api.deepseek.com/beta") {
		super(apiKey, apiBase);
	}

	/**
	 * 公开的消息规范化入口。
	 * 仅供测试或外部直接调用时使用；transformRequest 内部也会自动调用。
	 * @param messages
	 */
	normalizeMessages(messages: Record<string, unknown>[]): void {
		this._normalizeMessagesForDeepSeek(messages);
	}

	/**
	 * DeepSeek 额外支持 thinking 和 reasoning_effort
	 */
	override getSupportedParams(): string[] {
		return [...super.getSupportedParams(), "thinking", "reasoning_effort"];
	}

	// -----------------------------------------------------------------------
	// Patch 4 – tool_use / tool_result 规范化
	// -----------------------------------------------------------------------

	/**
	 * 将消息列表原地规范化为 DeepSeek 兼容格式。
	 *
	 * 1. server_tool_use → tool_use
	 * 2. assistant 中的 tool_result 提取到下一 user 消息
	 * 3. assistant content 中 text 块排在 tool_use 之前
	 * 4. tool_result 按 tool_use ID 顺序重排
	 * 5. 为无 thinking 的 assistant 注入空 thinking 块
	 * @param messages
	 */
	private _normalizeMessagesForDeepSeek(messages: Record<string, unknown>[]): void {
		// -- Patch 4: interleaved tool handling ----------------------------------
		let needsNormalize = false;
		for (const msg of messages) {
			if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
				continue;
			}
			for (const block of msg.content as Record<string, unknown>[]) {
				if (typeof block === "object" && (block.type === "server_tool_use" || block.type === "tool_result")) {
					needsNormalize = true;
					break;
				}
			}
			if (needsNormalize) {
				break;
			}
		}

		if (needsNormalize) {
			const normalized: Record<string, unknown>[] = [];
			let pendingResults: Record<string, unknown>[] = [];

			for (const msg of messages) {
				const role = msg.role as string;

				// Inject pending tool_results into the next user message
				if (role === "user" && pendingResults.length > 0) {
					const content = msg.content;
					if (Array.isArray(content)) {
						normalized.push({
							role: "user",
							content: [...pendingResults, ...content],
						});
					} else {
						normalized.push({ role: "user", content: [...pendingResults] });
						normalized.push(msg);
					}
					pendingResults = [];
					continue;
				}

				if (role === "assistant" && Array.isArray(msg.content)) {
					const content = msg.content as Record<string, unknown>[];
					const hasServerOrResult = content.some(
						(b) => typeof b === "object" && (b.type === "server_tool_use" || b.type === "tool_result"),
					);

					if (!hasServerOrResult) {
						normalized.push(msg);
						continue;
					}

					// Rebuild: text blocks first, then tool_use blocks (at end)
					const textBlocks: Record<string, unknown>[] = [];
					const toolUseBlocks: Record<string, unknown>[] = [];
					const resultBlocks: Record<string, unknown>[] = [];
					const toolUseIds: string[] = [];

					for (const block of content) {
						if (typeof block !== "object") {
							textBlocks.push(block);
							continue;
						}
						const btype = block.type as string;
						if (btype === "tool_result") {
							resultBlocks.push(block);
						} else if (btype === "server_tool_use") {
							toolUseBlocks.push({ ...block, type: "tool_use" });
							toolUseIds.push(String(block.id ?? ""));
						} else if (btype === "tool_use") {
							toolUseBlocks.push(block);
							toolUseIds.push(String(block.id ?? ""));
						} else {
							textBlocks.push(block);
						}
					}

					// Reorder result_blocks to match tool_use_ids order
					const resultById = new Map<string, Record<string, unknown>>();
					for (const rb of resultBlocks) {
						resultById.set(String(rb.tool_use_id ?? ""), rb);
					}
					const orderedResults: Record<string, unknown>[] = [];
					for (const uid of toolUseIds) {
						if (resultById.has(uid)) {
							orderedResults.push(resultById.get(uid)!);
							resultById.delete(uid);
						}
					}
					for (const remaining of resultById.values()) {
						orderedResults.push(remaining);
					}

					normalized.push({ role: "assistant", content: [...textBlocks, ...toolUseBlocks] });
					pendingResults = orderedResults;
					continue;
				}

				normalized.push(msg);
			}

			// If there are still pending results at the end, append a user message
			if (pendingResults.length > 0) {
				normalized.push({ role: "user", content: pendingResults });
			}

			// Mutate the original array in place
			messages.length = 0;
			messages.push(...normalized);
		}

		// -- Patch 5: thinking block injection ------------------------------------
		for (const msg of messages) {
			if (typeof msg.role !== "string" || msg.role !== "assistant") {
				continue;
			}
			const content = msg.content;

			if (Array.isArray(content)) {
				const blocks = content as Record<string, unknown>[];
				const hasThinking = blocks.some((b) => typeof b === "object" && (b.type === "thinking" || b.type === "redacted_thinking"));
				if (!hasThinking) {
					blocks.unshift({ type: "thinking", thinking: "", signature: "" });
				}
			} else if (typeof content === "string") {
				msg.content = [
					{ type: "thinking", thinking: "", signature: "" },
					{ type: "text", text: content },
				];
			}
		}
	}

	// -----------------------------------------------------------------------
	// Override transformRequest
	// -----------------------------------------------------------------------

	/**
	 * @param model
	 * @param messages
	 * @param optionalParams
	 */
	override transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		// Strip "deepseek/" provider prefix if present
		const strippedModel = model.startsWith("deepseek/") ? model.slice("deepseek/".length) : model;

		// Deep-copy messages so normalization doesn't mutate the caller's data
		const normalizedMessages: Record<string, unknown>[] = JSON.parse(JSON.stringify(messages));

		// Apply DeepSeek-specific message normalization for deepseek-* models
		if (strippedModel.startsWith("deepseek-")) {
			this._normalizeMessagesForDeepSeek(normalizedMessages);
		}

		// Map reasoning_effort to thinking param (DeepSeek doesn't support budget_tokens)
		if (optionalParams.reasoning_effort !== undefined && optionalParams.thinking === undefined) {
			const effort = optionalParams.reasoning_effort as string;
			if (effort !== "none") {
				optionalParams.thinking = { type: "enabled" };
			}
			delete optionalParams.reasoning_effort;
		}

		// Delegate to base class with normalized messages
		this._convertMessageContentsToString(normalizedMessages);

		return super.transformRequest(strippedModel, normalizedMessages as unknown as Message[], optionalParams);
	}

	/** Convert list-format content to string for DeepSeek API compatibility (Python: _transform_messages line 82-94) */
	/**
	 * Convert list-format content to string — preserves text while noting non-text blocks (Python: _transform_messages)
	 * @param normalizedMessages
	 */
	private _convertMessageContentsToString(normalizedMessages: Record<string, unknown>[]): void {
		for (const msg of normalizedMessages) {
			if (Array.isArray(msg.content)) {
				const blocks = msg.content as Array<Record<string, unknown>>;
				const hasOnlyText = blocks.every((b) => b.type === "text");
				if (hasOnlyText) {
					msg.content = blocks.map((b) => b.text ?? "").join("");
				}
				// If there are non-text blocks (images, tool results), keep the array structure
			}
		}
	}
}
