/**
 * 订阅运行时的会话与请求头工具。
 *
 * 桥接层只负责生成稳定的亲和键；真正发给上游的值由各 Provider 决定，
 * 但所有 Provider 都必须先剥掉桥接层加上的字段名前缀，避免把内部
 * `header:value` 形式泄漏给上游。
 */

import { createHash } from "node:crypto";

/** 会话头优先级；越靠前越可信。 */
export const SESSION_HEADER_NAMES = [
	"x-commandcode-session",
	"x-opencode-session",
	"x-litellm-session",
	"x-session-id",
	"session-id",
	"session_id",
	"x-claude-code-session-id",
	"x-codex-session-id",
	"conversation_id",
	"x-conversation-id",
] as const;

/** 会话体字段优先级。 */
export const SESSION_BODY_KEYS = ["prompt_cache_key", "conversation_id", "session_id"] as const;

/** 会话 metadata 字段优先级。 */
export const SESSION_METADATA_KEYS = ["user_id", "session_id", "conversation_id"] as const;

/**
 * 大小写不敏感地读取请求头。
 * @param headers - 请求头
 * @param name - 头名
 * @returns 头值；不存在时返回 undefined
 */
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const target = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === target) {
			return value;
		}
	}
	return undefined;
}

/**
 * 清理会进入上游请求头的值。
 * @param value - 原始值
 * @param maxLength - 最大长度
 * @returns 去掉控制字符并截断后的值
 */
export function sanitizeHeaderValue(value: string, maxLength = 256): string {
	let cleaned = "";
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 0x1f || code === 0x7f) {
			continue;
		}
		cleaned += character;
	}
	return cleaned.trim().slice(0, maxLength);
}

/**
 * 剥掉桥接层为会话键加上的字段名前缀。
 *
 * 桥接层返回 `x-session-id:abc` / `content:<hash>` 这类形式；上游只应看到
 * `abc` / `<hash>`。客户端自带 `foo:bar` 且不是已知前缀时原样保留。
 * @param sessionKey - 桥接层会话键
 * @returns 可发给上游的裸值
 */
export function sessionKeyValue(sessionKey: string): string {
	const trimmed = sessionKey.trim();
	const separator = trimmed.indexOf(":");
	if (separator <= 0) {
		return trimmed;
	}
	const prefix = trimmed.slice(0, separator).toLowerCase();
	const known =
		SESSION_HEADER_NAMES.includes(prefix as (typeof SESSION_HEADER_NAMES)[number]) ||
		SESSION_BODY_KEYS.includes(prefix as (typeof SESSION_BODY_KEYS)[number]) ||
		prefix === "content" ||
		prefix.startsWith("metadata.");
	return known ? trimmed.slice(separator + 1).trim() : trimmed;
}

/**
 * 派生稳定的设备/客户端标识。
 * @param seed - 账号或安装标识
 * @returns SHA-256 十六进制摘要
 */
export function stableDeviceId(seed: string): string {
	return createHash("sha256").update(seed).digest("hex");
}

/**
 * 计算会话亲和键。
 *
 * 优先使用调用方显式传入的会话头，其次使用请求体中的会话/缓存键，最后回退到
 * 首条用户消息的哈希。返回值带来源前缀，Provider 使用 {@link sessionKeyValue}
 * 取裸值。
 * @param headers - 请求头
 * @param body - 请求体
 * @returns 会话键；没有可用线索时为空字符串
 */
export function resolveSessionKey(headers: Record<string, string>, body: Record<string, unknown>): string {
	for (const name of SESSION_HEADER_NAMES) {
		const value = headerValue(headers, name);
		if (value?.trim()) {
			return `${name}:${value.trim()}`;
		}
	}
	for (const key of SESSION_BODY_KEYS) {
		const value = body[key];
		if (typeof value === "string" && value.trim()) {
			return `${key}:${value.trim()}`;
		}
	}
	const metadata = body["metadata"];
	if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
		const record = metadata as Record<string, unknown>;
		for (const key of SESSION_METADATA_KEYS) {
			const value = record[key];
			if (typeof value === "string" && value.trim()) {
				return `metadata.${key}:${value.trim()}`;
			}
		}
	}
	const firstUser = firstUserContent(body);
	if (firstUser) {
		return `content:${createHash("sha256").update(firstUser).digest("hex").slice(0, 24)}`;
	}
	return "";
}

/**
 * 提取首条用户消息的文本。
 * @param body - 请求体
 * @returns 首条用户文本；不存在时 undefined
 */
function firstUserContent(body: Record<string, unknown>): string | undefined {
	const candidates: unknown[] = [];
	if (Array.isArray(body["messages"])) {
		candidates.push(...(body["messages"] as unknown[]));
	}
	const input = body["input"];
	if (Array.isArray(input)) {
		candidates.push(...input);
	} else if (typeof input === "string") {
		return input;
	}
	for (const item of candidates) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			continue;
		}
		const message = item as Record<string, unknown>;
		if (message["role"] !== "user") {
			continue;
		}
		const content = message["content"];
		if (typeof content === "string") {
			return content;
		}
		if (Array.isArray(content)) {
			const texts = content
				.map((part) => {
					if (part && typeof part === "object" && typeof (part as Record<string, unknown>)["text"] === "string") {
						return (part as Record<string, unknown>)["text"] as string;
					}
					return "";
				})
				.filter(Boolean);
			if (texts.length > 0) {
				return texts.join("\n");
			}
		}
	}
	return undefined;
}
