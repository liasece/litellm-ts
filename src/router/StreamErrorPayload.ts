/**
 * 流式 chunk 里上游错误块的文本化。
 *
 * 上游在 SSE 里下发的错误块通常是对象（`data: {"error":{"message":"..."}}`）。直接
 * `String(对象)` 只会得到 `[object Object]`：客户端看不到原因，按文本判定的降级逻辑
 * （如 `isThinkingReplayRejection`）也随之失效。
 *
 * 生产 request 38df4018 就是这样把 CommandCode 侧的中断和随后两条上游 400 一起压成了
 * `[object Object]`，SpendLog 与客户端都只剩这一串。这里按「先保住上游原话」的顺序取文本，
 * 只有在完全没有可用字段时才退回序列化结果。
 */

/** 消息长度上限：错误块可能夹带整段上游响应，日志与客户端都不该被它拖长。 */
const MAX_MESSAGE_LENGTH = 1000;

/** 嵌套 `{error:{error:{...}}}` 的展开上限。 */
const MAX_NESTING_DEPTH = 3;

/** 从错误块里取不到任何文本时的兜底文案。 */
const FALLBACK_MESSAGE = "上游在流式响应中返回了错误块（无可读消息）";

/** 常见消息字段，按可信度排序。 */
const MESSAGE_FIELDS = ["message", "detail", "msg", "reason"] as const;

/** 可能包住真实错误的嵌套字段。 */
const NESTED_FIELDS = ["error", "errors", "response"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 去掉首尾空白并按上限截断。
 * @param text - 原始文本
 */
function clip(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return "";
	}
	return trimmed.length > MAX_MESSAGE_LENGTH ? `${trimmed.slice(0, MAX_MESSAGE_LENGTH)}…` : trimmed;
}

/**
 * 序列化兜底：保留结构信息，避免再次退化成 `[object Object]`。
 * @param payload - 待序列化的错误块
 */
function serialize(payload: unknown): string {
	try {
		const text = JSON.stringify(payload);
		return typeof text === "string" ? clip(text) : "";
	} catch {
		return "";
	}
}

/**
 * 取对象上的第一个非空消息字段。
 * @param record - 错误块对象
 */
function pickMessageField(record: Record<string, unknown>): string {
	for (const field of MESSAGE_FIELDS) {
		const value = record[field];
		if (typeof value === "string") {
			const text = clip(value);
			if (text.length > 0) {
				return text;
			}
		}
	}
	return "";
}

/**
 * 递归提取错误块文本；取不到时返回空字符串。
 * @param payload - 错误块任意层级
 * @param depth - 当前嵌套层级
 */
function extract(payload: unknown, depth: number): string {
	if (payload === undefined || payload === null) {
		return "";
	}
	if (typeof payload === "string") {
		return clip(payload);
	}
	if (payload instanceof Error) {
		return clip(payload.message);
	}
	if (typeof payload === "number" || typeof payload === "boolean") {
		return String(payload);
	}
	if (Array.isArray(payload)) {
		for (const entry of payload) {
			const text = extract(entry, depth + 1);
			if (text.length > 0) {
				return text;
			}
		}
		return serialize(payload);
	}
	if (!isRecord(payload)) {
		return serialize(payload);
	}
	const own = pickMessageField(payload);
	if (own.length > 0) {
		return own;
	}
	if (depth < MAX_NESTING_DEPTH) {
		for (const field of NESTED_FIELDS) {
			if (!(field in payload)) {
				continue;
			}
			const text = extract(payload[field], depth + 1);
			if (text.length > 0) {
				return text;
			}
		}
	}
	return serialize(payload);
}

/**
 * 把流里下发的错误块转成可读文本。
 *
 * 支持的形态：字符串、`Error`、`{message|detail|msg|reason}`、OpenAI 风格
 * `{error:{message}}`、嵌套数组以及无法识别时的 JSON 序列化。
 * @param payload - chunk 里的 `error` 字段
 */
export function streamErrorPayloadMessage(payload: unknown): string {
	return extract(payload, 0) || FALLBACK_MESSAGE;
}
