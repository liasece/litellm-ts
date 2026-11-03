/**
 * 日志详情页的字段提取规则表。
 *
 * 各家供应商返回的内容块形状不同，同一个语义散落在不同字段里（OpenAI Responses 用
 * `summary`/`content`，Anthropic 用 `thinking`，Gemini 用 `text`）。历史上这些候选字段
 * 写成散落的 `a ?? b ?? c`，带来两个反复出现的问题：
 *
 * 1. `??` 只判断「非 null」：供应商常把不用的字段填成空数组或空对象（Responses 的
 *    reasoning item 固定带 `summary: []`），空容器会挡住真正有内容的一侧，页面显示空白；
 * 2. 候选顺序散在各处，同一份数据在不同视图（详情页 / Session 时间线）可能取到不同字段。
 *
 * 这里把「某个语义该读哪些字段、按什么顺序」集中成一张表，取值统一走
 * {@link readFieldRule}，按「确实有内容」而不是「非 null」挑选。新增供应商或字段形状
 * 变化时只改这张表，不必再翻调用点。
 */

/** 候选字段路径；支持 `a.b` 形式的嵌套路径。 */
export type FieldPath = string;

/** 一个语义字段的提取规则。 */
export interface FieldRule {
	/** 按优先级排列的候选字段；靠前的是更贴近客户端语义的表示。 */
	readonly candidates: readonly FieldPath[];
	/** 全部候选都没有内容时返回的值。 */
	readonly fallback?: unknown;
}

/**
 * 值是否「确实有内容」。
 *
 * 空字符串、空数组、空对象都视为没有内容：它们只是供应商为结构完整性填的占位。
 * @param value - 待判断的候选值
 */
export function isMeaningful(value: unknown): boolean {
	if (value === null || value === undefined) {
		return false;
	}
	if (typeof value === "string") {
		// 上游有时只产出空白字符（实测 reasoning 会是一个空格，且 reasoning_tokens 为 1），
		// trim 后为空说明用户看不到任何内容，应与空字符串同等对待。
		return value.trim().length > 0;
	}
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	if (typeof value === "object") {
		return Object.keys(value as Record<string, unknown>).length > 0;
	}
	return true;
}

/**
 * 按 `a.b` 路径读取嵌套字段。
 * @param record - 源对象
 * @param path - 字段路径
 */
export function readFieldPath(record: unknown, path: FieldPath): unknown {
	let current: unknown = record;
	for (const segment of path.split(".")) {
		if (current === null || typeof current !== "object" || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/**
 * 按规则表读取第一个有内容的候选值。
 * @param record - 源对象（内容块、消息等）
 * @param rule - 该语义的提取规则
 */
export function readFieldRule(record: unknown, rule: FieldRule): unknown {
	for (const candidate of rule.candidates) {
		const value = readFieldPath(record, candidate);
		if (isMeaningful(value)) {
			return value;
		}
	}
	return rule.fallback;
}

/**
 * 内容块与消息的字段提取规则表。
 *
 * 每个语义只在这里声明一次；调用点通过 {@link readFieldRule} 取值。注释标出该条规则
 * 针对的供应商形状，便于新增供应商时判断该挂到哪条规则上。
 */
export const PRETTY_FIELD_RULES = {
	/** 思考/推理正文：Anthropic thinking、Responses summary+content、Gemini text。 */
	reasoning: {
		// summary 是给客户端看的摘要，排在完整正文之前；为空时自动回退到正文。
		candidates: ["thinking", "summary", "text", "content"],
	} as FieldRule,

	/** chat 协议消息上的推理文本。 */
	messageReasoning: {
		candidates: ["reasoning_content", "reasoning", "analysis", "thinking"],
	} as FieldRule,

	/** 工具结果正文：Responses/Anthropic/MCP 各自不同。 */
	toolResult: {
		candidates: ["content", "output", "result", "response"],
	} as FieldRule,

	/** 工具调用名。 */
	toolName: {
		candidates: ["name", "function.name", "tool_name"],
	} as FieldRule,

	/** 工具调用参数。 */
	toolArguments: {
		candidates: ["input", "arguments", "function.arguments", "parameters"],
	} as FieldRule,

	/** 工具调用 id。 */
	toolCallId: {
		candidates: ["id", "call_id", "tool_use_id", "tool_call_id"],
		fallback: "",
	} as FieldRule,

	/** 联网检索块的文本。 */
	webSearchText: {
		candidates: ["query", "content", "result"],
	} as FieldRule,

	/** 可执行代码正文。 */
	code: {
		candidates: ["code", "input"],
	} as FieldRule,

	/** 代码执行结果正文。 */
	codeResult: {
		candidates: ["output", "result"],
	} as FieldRule,

	/** 图片原始来源（URL 或 base64）。 */
	imageSource: {
		candidates: ["image_url.url", "image_url", "url", "source.data", "data", "file_id"],
	} as FieldRule,

	/** 图片 MIME 类型。 */
	imageMimeType: {
		candidates: ["mime_type", "mimeType", "media_type", "mediaType", "source.media_type", "source.mime_type"],
	} as FieldRule,

	/** 文档名称或引用。 */
	documentLabel: {
		candidates: ["filename", "file_id", "url", "source"],
		fallback: "Attached document",
	} as FieldRule,

	/** 拒答文本。 */
	refusal: {
		candidates: ["refusal", "text"],
	} as FieldRule,

	/** 消息正文，兼容 content 与 parts 两种形状。 */
	messageContent: {
		candidates: ["content", "parts"],
	} as FieldRule,
} as const;
