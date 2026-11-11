/**
 * 目标供应商的签名回放约束。
 *
 * 协议转换只负责把 canonical IR 转成目标协议；签名是否可回放由目标边界决定。
 * 这里集中处理三种会解密/校验签名的目标：
 * - Claude Messages：外来 thinking 签名必须连块删除，tool_use 上的签名字段全部移除；
 * - Gemini（含 Antigravity）：第一个 functionCall 缺少兼容签名时补 bypass sentinel；
 * - xAI Responses：外来 reasoning/compaction encrypted_content 必须连条目删除。
 *
 * 先排除 Codex/DeepSeek/Kimi 等形状明确的签名，再用 protobuf 信封区分 Claude
 * 与 Gemini 的 E 开头签名；无法确认的值保持原样，避免误删真正可回放的上下文。
 */

import { classifySignatureFamily, isDefinitelyForeignSignature } from "./signatureCompatibility";

/** Gemini 官方认可的无签名历史 bypass sentinel。 */
export const GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR = "skip_thought_signature_validator";

/** Gemini part 上可能承载签名的字段。 */
const GEMINI_SIGNATURE_FIELDS = ["thoughtSignature", "thought_signature"] as const;

/** Claude tool_use 上不应出现的签名来源字段。 */
const CLAUDE_TOOL_SIGNATURE_FIELDS = ["signature", "thoughtSignature", "thought_signature"] as const;

/**
 * 读取对象；非对象返回 undefined。
 * @param value - 任意值
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * 读取字符串；非字符串返回 undefined。
 * @param value - 任意值
 */
function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/**
 * 判断签名是否能交给 Claude 原生端点回放。
 *
 * Q 是 Antigravity 的 Claude CAQS 包装，虽然内容属于 Claude，但 Claude 原生
 * 端点不能解包；E/R/C 与无法识别的值保持原样，避免误删原生历史。
 * @param raw - thinking signature / redacted data
 */
function isClaudeReplayableSignature(raw: string): boolean {
	if (isDefinitelyForeignSignature(raw)) {
		return false;
	}
	const value = raw.trim();
	if (value.startsWith("Q")) {
		return false;
	}
	const family = classifySignatureFamily(value);
	if (family === "claude") {
		return true;
	}
	if (family === "gemini") {
		return false;
	}
	// 无法结构确认时，只有 Claude 家族可能使用的 E/R/C 前缀才保留；
	// 其它形状（xAI 随机密文、未知标识）不能证明可回放，删除整块更安全。
	return value.startsWith("E") || value.startsWith("R") || value.startsWith("C");
}

/**
 * 判断签名是否不能交给 Gemini 回放。
 * @param raw - thoughtSignature
 */
function isGeminiReplayableSignature(raw: string): boolean {
	if (raw.trim() === GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR) {
		return true;
	}
	if (isDefinitelyForeignSignature(raw)) {
		return false;
	}
	return classifySignatureFamily(raw) === "gemini";
}

/**
 * 判断 encrypted_content 是否不能交给 xAI 回放。
 *
 * xAI 没有自描述信封，无法从形状确认原生载荷；这里只排除已识别的其它家族，
 * 未识别的 base64 保持原样，避免把 xAI 自己的 reasoning 全部丢掉。
 * @param raw - encrypted_content
 */
function isXaiForeignEncryptedContent(raw: string): boolean {
	if (isDefinitelyForeignSignature(raw)) {
		return true;
	}
	const family = classifySignatureFamily(raw);
	return family === "claude" || family === "gemini";
}

/**
 * 清理 Claude Messages 请求里无法由 Claude 回放的签名。
 *
 * - `thinking`：没有签名或签名明确属于其它供应商时删除整块；Claude 没有
 *   跨供应商的 thinking 签名 bypass，保留会直接 400。
 * - `redacted_thinking`：同样要求 data 存在且不是外来签名。
 * - `tool_use`：Anthropic 的 tool_use 没有签名语义，移除所有签名来源字段，
 *   其中也包括 Gemini 写在 tool_use 上的 thoughtSignature。
 *
 * 原地修改请求体；删除块后为空的 assistant 消息会被移除。
 * @param body - Anthropic Messages 请求体
 */
export function sanitizeClaudeMessagesSignatures(body: Record<string, unknown>): void {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return;
	}
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = asRecord(messages[index]);
		if (!message) {
			continue;
		}
		const content = message["content"];
		if (!Array.isArray(content)) {
			continue;
		}
		const kept: unknown[] = [];
		for (const rawBlock of content) {
			const block = asRecord(rawBlock);
			if (!block) {
				kept.push(rawBlock);
				continue;
			}
			const type = asString(block["type"]);
			if (type === "thinking") {
				const signature = asString(block["signature"]);
				if (
					signature === undefined ||
					signature.trim().length === 0 ||
					!isClaudeReplayableSignature(signature)
				) {
					continue;
				}
				kept.push(block);
				continue;
			}
			if (type === "redacted_thinking") {
				const data = asString(block["data"]);
				if (
					data === undefined ||
					data.trim().length === 0 ||
					!isClaudeReplayableSignature(data)
				) {
					continue;
				}
				kept.push(block);
				continue;
			}
			if (type === "tool_use") {
				stripClaudeToolSignatureFields(block);
			}
			kept.push(block);
		}
		if (kept.length === 0) {
			messages.splice(index, 1);
			continue;
		}
		message["content"] = kept;
	}
}

/**
 * 移除 Claude tool_use 上的签名来源字段。
 * @param block - tool_use 块；原地修改
 */
function stripClaudeToolSignatureFields(block: Record<string, unknown>): void {
	for (const field of CLAUDE_TOOL_SIGNATURE_FIELDS) {
		delete block[field];
	}
	const extra = asRecord(block["extra_content"]);
	if (!extra) {
		return;
	}
	const google = asRecord(extra["google"]);
	if (google) {
		for (const field of GEMINI_SIGNATURE_FIELDS) {
			delete google[field];
		}
		if (Object.keys(google).length === 0) {
			delete extra["google"];
		}
	}
	if (Object.keys(extra).length === 0) {
		delete block["extra_content"];
	}
}

/**
 * 清理 Antigravity Claude 模型的 thoughtSignature。
 *
 * Antigravity 的 Claude 腿接收 Claude 签名（含 Q 包装），不能用 Gemini 的
 * bypass sentinel 代替；这里只删除明确属于其它家族的签名，保留 Claude 与
 * 无法识别的原生值。
 * @param request - Antigravity v1internal.request
 */
export function sanitizeAntigravityClaudeSignatures(request: Record<string, unknown>): void {
	const contents = Array.isArray(request["contents"])
		? request["contents"]
		: Array.isArray(request["content"])
			? request["content"]
			: undefined;
	if (!contents) {
		return;
	}
	for (const rawMessage of contents) {
		const message = asRecord(rawMessage);
		if (!message) {
			continue;
		}
		const role = asString(message["role"]);
		if (role !== "model" && role !== "assistant") {
			continue;
		}
		const parts = message["parts"];
		if (!Array.isArray(parts)) {
			continue;
		}
		for (const rawPart of parts) {
			const part = asRecord(rawPart);
			if (!part) {
				continue;
			}
			const signature = readGeminiSignature(part);
			if (signature !== undefined && !isClaudeFamilySignature(signature)) {
				clearGeminiSignature(part);
			}
		}
	}
}

/**
 * 判断签名是否属于 Claude 家族（含 Q 包装）。
 * @param raw - thoughtSignature
 */
function isClaudeFamilySignature(raw: string): boolean {
	if (isDefinitelyForeignSignature(raw)) {
		return false;
	}
	return classifySignatureFamily(raw) !== "gemini";
}

/**
 * 清理 Gemini 请求里无法由 Gemini 回放的 thoughtSignature。
 *
 * Gemini 对带 functionResponse 的 functionCall 会校验签名；迁移自其它供应商
 * 的首个 functionCall 没有 Gemini 签名时，必须写入官方 bypass sentinel。
 * 后续 functionCall 与普通 text/thought part 不接受外来签名，直接移除字段。
 * 原生 Gemini 签名（无法可靠识别时）保持不动。
 * @param request - Gemini 请求体（Antigravity 的 v1internal.request 亦可）
 */
export function sanitizeGeminiRequestSignatures(request: Record<string, unknown>): void {
	const contents = Array.isArray(request["contents"])
		? request["contents"]
		: Array.isArray(request["content"])
			? request["content"]
			: undefined;
	if (!contents) {
		return;
	}
	let firstFunctionCallSeen = false;
	for (const rawMessage of contents) {
		const message = asRecord(rawMessage);
		if (!message) {
			continue;
		}
		const role = asString(message["role"]);
		if (role !== "model" && role !== "assistant") {
			continue;
		}
		const parts = message["parts"];
		if (!Array.isArray(parts)) {
			continue;
		}
		for (const rawPart of parts) {
			const part = asRecord(rawPart);
			if (!part) {
				continue;
			}
			const functionCall = asRecord(part["functionCall"]) ?? asRecord(part["function_call"]);
			const signature = readGeminiSignature(part);
			if (functionCall) {
				const isFirst = !firstFunctionCallSeen;
				firstFunctionCallSeen = true;
				if (isFirst) {
					if (signature === undefined || !isGeminiReplayableSignature(signature)) {
						clearGeminiSignature(part);
						part["thoughtSignature"] = GEMINI_SKIP_THOUGHT_SIGNATURE_VALIDATOR;
					}
					continue;
				}
				if (signature !== undefined && !isGeminiReplayableSignature(signature)) {
					clearGeminiSignature(part);
				}
				continue;
			}
			if (signature !== undefined && !isGeminiReplayableSignature(signature)) {
				clearGeminiSignature(part);
			}
		}
	}
}

/**
 * 读取 Gemini part 的签名，含 functionCall 内的别名。
 * @param part - Gemini part
 */
function readGeminiSignature(part: Record<string, unknown>): string | undefined {
	for (const field of GEMINI_SIGNATURE_FIELDS) {
		const value = asString(part[field]);
		if (value !== undefined) {
			return value;
		}
	}
	const functionCall = asRecord(part["functionCall"]) ?? asRecord(part["function_call"]);
	if (functionCall) {
		for (const field of GEMINI_SIGNATURE_FIELDS) {
			const value = asString(functionCall[field]);
			if (value !== undefined) {
				return value;
			}
		}
	}
	return undefined;
}

/**
 * 删除 Gemini part 上所有签名别名。
 * @param part - Gemini part；原地修改
 */
function clearGeminiSignature(part: Record<string, unknown>): void {
	for (const field of GEMINI_SIGNATURE_FIELDS) {
		delete part[field];
	}
	for (const key of ["functionCall", "function_call"] as const) {
		const functionCall = asRecord(part[key]);
		if (!functionCall) {
			continue;
		}
		for (const field of GEMINI_SIGNATURE_FIELDS) {
			delete functionCall[field];
		}
	}
}

/**
 * 清理 xAI Responses 请求里无法解密回放的 reasoning/compaction 条目。
 *
 * xAI 会把 encrypted_content 交给自己的解密器；外来 GPT/Claude/DeepSeek 载荷
 * 会返回 400。没有 provenance 的其它 base64 保持原样，避免误删 xAI 原生上下文。
 * @param body - Responses 请求体；原地修改
 */
export function sanitizeXaiResponsesInput(body: Record<string, unknown>): void {
	const input = body["input"];
	if (!Array.isArray(input)) {
		return;
	}
	body["input"] = input.filter((rawItem) => {
		const item = asRecord(rawItem);
		if (!item) {
			return true;
		}
		const type = asString(item["type"]);
		if (type !== "reasoning" && type !== "compaction") {
			return true;
		}
		const encrypted = asString(item["encrypted_content"]);
		if (encrypted === undefined) {
			return true;
		}
		return !isXaiForeignEncryptedContent(encrypted);
	});
}
