/**
 * 上游工具名归一化。
 *
 * 原型协议对工具名的字符集和长度限制并不一致；客户端的长 MCP 名称或带命名
 * 空间的名称直接透传会在上游 400。这里只做目标无关的“安全名称”映射，
 * 由桥接层在响应/SSE 回到客户端前还原，Provider 仍决定自己的长度上限。
 */

import { createHash } from "node:crypto";

/** 安全工具名到客户端原始名称的映射。 */
export type ToolNameMapping = ReadonlyMap<string, string>;

/** 上游工具名上限。 */
export interface ToolNamePolicy {
	/** 最大字符数。 */
	readonly maxLength: number;
}

/** 默认上限；Anthropic/OpenAI 兼容端点通常为 64。 */
export const DEFAULT_TOOL_NAME_MAX_LENGTH = 64;

/** Responses 中承载工具名、需要还原的字段。 */
const TOOL_NAME_KEYS = new Set(["name", "tool_name", "allowedFunctionNames"]);

/**
 * 生成安全工具名。
 * @param name - 原始名称
 * @param maxLength - 最大长度
 * @returns 安全名称
 */
function safeName(name: string, maxLength: number): string {
	const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "_");
	const digest = createHash("sha256").update(name).digest("hex").slice(0, 8);
	const base = cleaned.length > 0 ? cleaned : `tool_${digest}`;
	if (base.length <= maxLength) {
		return base;
	}
	const suffix = `_${digest}`;
	return `${base.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}

/**
 * 收集并替换一个请求体里的工具名。
 * @param body - 请求体；原地修改
 * @param maxLength - 安全名称上限
 * @returns 安全名称到原始名称的映射；没有变化时 undefined
 */
export function normalizeToolNames(
	body: Record<string, unknown>,
	maxLength = DEFAULT_TOOL_NAME_MAX_LENGTH,
): ToolNameMapping | undefined {
	const safeToOriginal = new Map<string, string>();
	const originalToSafe = new Map<string, string>();
	const usedSafe = new Map<string, string>();
	const replace = (value: unknown): string | undefined => {
		if (typeof value !== "string" || value.length === 0) {
			return undefined;
		}
		const existing = originalToSafe.get(value);
		if (existing !== undefined) {
			return existing;
		}
		const candidate = safeName(value, maxLength);
		let unique = candidate;
		const collision = usedSafe.get(unique);
		if (collision !== undefined && collision !== value) {
			const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
			unique = `${candidate.slice(0, Math.max(0, maxLength - 9))}_${digest}`.slice(0, maxLength);
		}
		usedSafe.set(unique, value);
		if (unique === value) {
			return value;
		}
		originalToSafe.set(value, unique);
		safeToOriginal.set(unique, value);
		return unique;
	};
	const replaceName = (record: Record<string, unknown>): void => {
		const name = record["name"];
		if (typeof name === "string") {
			const safe = replace(name);
			if (safe !== undefined) {
				record["name"] = safe;
			}
		}
	};
	const replaceFunction = (value: unknown): void => {
		const record = asRecord(value);
		if (record !== undefined) {
			replaceName(record);
		}
	};
	const replaceDeclarations = (value: unknown): void => {
		for (const declaration of asArray(value)) {
			const record = asRecord(declaration);
			if (record !== undefined) {
				replaceName(record);
			}
		}
	};
	const replaceTools = (value: unknown): void => {
		for (const tool of asArray(value)) {
			const record = asRecord(tool);
			if (record === undefined) {
				continue;
			}
			replaceDeclarations(record["functionDeclarations"]);
			replaceDeclarations(record["function_declarations"]);
			const functionRecord = asRecord(record["function"]);
			if (functionRecord !== undefined) {
				replaceName(functionRecord);
			}
			if (record["type"] === "function" || record["type"] === "custom") {
				replaceName(record);
			} else if (record["type"] === undefined && typeof record["name"] === "string") {
				// Anthropic Messages 的 tool 声明直接使用根级 name。
				replaceName(record);
			}
		}
	};
	const replaceToolChoice = (value: unknown): void => {
		const record = asRecord(value);
		if (record === undefined) {
			return;
		}
		replaceFunction(record["function"]);
		if (record["type"] === "tool" || record["type"] === "function") {
			replaceName(record);
		}
		const allowed = record["allowedFunctionNames"];
		if (Array.isArray(allowed)) {
			record["allowedFunctionNames"] = allowed.map((name) => replace(typeof name === "string" ? name : "") ?? name);
		}
		const nestedConfig = asRecord(record["functionCallingConfig"]);
		if (nestedConfig !== undefined) {
			replaceToolChoice(nestedConfig);
		}
	};
	const replaceMessage = (value: unknown): void => {
		const record = asRecord(value);
		if (record === undefined) {
			return;
		}
		for (const call of asArray(record["tool_calls"])) {
			replaceFunction(asRecord(call)?.["function"]);
		}
		for (const block of asArray(record["content"])) {
			const part = asRecord(block);
			if (part === undefined) {
				continue;
			}
			if (part["type"] === "tool_use" || part["type"] === "tool_call") {
				replaceName(part);
			}
			replaceFunction(part["function"]);
		}
	};
	const replaceItem = (value: unknown): void => {
		const record = asRecord(value);
		if (record === undefined) {
			return;
		}
		const type = typeof record["type"] === "string" ? record["type"] : "";
		if (type === "function_call" || type === "custom_tool_call" || type === "tool_call") {
			replaceName(record);
		}
		replaceFunction(record["function"]);
	};
	const replaceGeminiContent = (value: unknown): void => {
		for (const content of asArray(value)) {
			const record = asRecord(content);
			if (record === undefined) {
				continue;
			}
			for (const part of asArray(record["parts"])) {
				const item = asRecord(part);
				if (item === undefined) {
					continue;
				}
				replaceFunction(item["functionCall"]);
				replaceFunction(item["functionResponse"]);
			}
		}
	};

	replaceTools(body["tools"]);
	replaceToolChoice(body["tool_choice"]);
	replaceToolChoice(body["toolChoice"]);
	const messages = body["messages"];
	if (Array.isArray(messages)) {
		for (const message of messages) {
			replaceMessage(message);
		}
	}
	const input = body["input"];
	if (Array.isArray(input)) {
		for (const item of input) {
			replaceItem(item);
			replaceMessage(item);
		}
	}
	replaceGeminiContent(body["contents"]);
	const request = asRecord(body["request"]);
	if (request !== undefined) {
		replaceTools(request["tools"]);
		replaceToolChoice(request["tool_config"]);
		replaceToolChoice(request["toolConfig"]);
		replaceGeminiContent(request["contents"]);
	}
	return safeToOriginal.size === 0 ? undefined : safeToOriginal;
}

/**
 * 把响应/SSE 事件里的安全工具名还原为客户端名称。
 * @param mapping - 安全名称到原始名称的映射
 * @param value - 响应体或事件数据；原地修改
 */
export function restoreToolNames(mapping: ToolNameMapping | undefined, value: unknown): void {
	if (mapping === undefined || mapping.size === 0) {
		return;
	}
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) {
				visit(item);
			}
			return;
		}
		const record = asRecord(node);
		if (record === undefined) {
			return;
		}
		for (const [key, child] of Object.entries(record)) {
			if (TOOL_NAME_KEYS.has(key)) {
				if (typeof child === "string") {
					const original = mapping.get(child);
					if (original !== undefined) {
						record[key] = original;
					}
				} else if (Array.isArray(child)) {
					record[key] = child.map((item) => (typeof item === "string" ? (mapping.get(item) ?? item) : item));
				}
				continue;
			}
			visit(child);
		}
	};
	visit(value);
}

/**
 * 读取对象。
 * @param value - 待判定值
 * @returns 对象记录；非对象时 undefined
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 读取数组。
 * @param value - 待判定值
 * @returns 数组；非数组时空数组
 */
function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
