import type { RequestMeta, RequestTool } from "../support/PrettyMessagesModels";
import { asRecord } from "./PrettyMessagesBlocksLogic";
import { isMeaningful } from "./PrettyMessagesFieldRules";
/** tools[] 条目里已经由 {@link RequestTool} 承载的键；其余键放进 extra，避免展开后丢信息。 */
const REQUEST_TOOL_KEYS = new Set(["name", "type", "description", "function", "parameters", "input_schema"]);
/** function 子对象里已经由 {@link RequestTool} 承载的键。 */
const FUNCTION_TOOL_KEYS = new Set(["name", "description", "parameters"]);

const toolText = (value: unknown): string => (typeof value === "string" && value.trim() ? value : "");

/** 按候选顺序取第一个有内容的参数 schema：OpenAI function.parameters、Responses parameters、Anthropic input_schema。 */
const toolParameters = (...candidates: unknown[]): unknown => candidates.find(isMeaningful);

/**
 * 把一条 tools[] 定义归一成可展示的字段。
 *
 * 兼容 OpenAI chat（function.name/description/parameters）、OpenAI Responses（扁平
 * name/description/parameters）与 Anthropic（name/description/input_schema）。没有名字的
 * 供应商内置工具（如 Responses 的 web_search）用声明的 type 作名字；名字和 type 都取不到的
 * 条目无法展示，直接跳过。
 */
const requestToolFromDefinition = (tool: unknown): RequestTool | null => {
	const record = asRecord(tool);
	if (!record) return null;
	const fn = asRecord(record.function);
	const declaredType = toolText(record.type);
	const name = toolText(fn?.name) || toolText(record.name) || (declaredType !== "function" ? declaredType : "");
	if (!name) return null;

	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (!REQUEST_TOOL_KEYS.has(key)) extra[key] = value;
	}
	for (const [key, value] of Object.entries(fn ?? {})) {
		if (!FUNCTION_TOOL_KEYS.has(key)) extra[`function.${key}`] = value;
	}

	const description = toolText(fn?.description) || toolText(record.description);
	const parameters = toolParameters(fn?.parameters, record.parameters, record.input_schema);

	return {
		name,
		type: declaredType || "function",
		...(description ? { description } : {}),
		...(parameters !== undefined ? { parameters } : {}),
		...(Object.keys(extra).length > 0 ? { extra } : {}),
	};
};

/**
 * 从请求中提取用于 pretty 视图顶部 tag 行的元信息。
 * 兼容 request 为 { body: {...} } 或直接为请求体对象两种形态。
 */
export const parseRequestMeta = (request: unknown): RequestMeta => {
	const body = asRecord(asRecord(request)?.body) || asRecord(request) || {};

	let reasoningEffort: string | undefined;
	if (typeof body.reasoning_effort === "string") {
		reasoningEffort = body.reasoning_effort;
	} else {
		const reasoning = asRecord(body.reasoning);
		if (reasoning && typeof reasoning.effort === "string") {
			reasoningEffort = reasoning.effort;
		} else {
			// Anthropic 原生 /v1/messages 用 output_config.effort 表达思考强度
			const outputConfig = asRecord(body.output_config);
			if (outputConfig && typeof outputConfig.effort === "string") {
				reasoningEffort = outputConfig.effort;
			}
		}
	}

	const thinking = asRecord(body.thinking);
	const thinkingBudget = thinking && typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : undefined;

	const tools = Array.isArray(body.tools)
		? body.tools.map(requestToolFromDefinition).filter((tool: RequestTool | null): tool is RequestTool => tool !== null)
		: [];

	let maxTokens: number | undefined;
	if (typeof body.max_tokens === "number") {
		maxTokens = body.max_tokens;
	} else if (typeof body.max_completion_tokens === "number") {
		maxTokens = body.max_completion_tokens;
	}

	return {
		model: typeof body.model === "string" ? body.model : undefined,
		reasoningEffort,
		thinkingBudget,
		tools,
		temperature: typeof body.temperature === "number" ? body.temperature : undefined,
		topP: typeof body.top_p === "number" ? body.top_p : undefined,
		maxTokens,
		stream: typeof body.stream === "boolean" ? body.stream : undefined,
	};
};

/**
 * 判断请求对象是否带有可用于提取元信息的请求体。
 * 上游日志未开启或请求体未记录时返回 false，调用方应回退到下游请求。
 */
export function hasRequestMetaBody(request: unknown): boolean {
	const body = asRecord(asRecord(request)?.body) || asRecord(request);
	return Boolean(body && Object.keys(body).length > 0);
}
