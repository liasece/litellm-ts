/**
 * 客户端已声明的网络工具：识别、改写成可调用函数、参数归一化。
 *
 * 背景：请求已经自带 `web_search` / `web_fetch`（或 Anthropic / Responses 的托管工具类型）时，
 * 再注入 `litellm__web_search` 会让模型在两套同类工具之间摇摆，并把这轮计入私有
 * max_iterations。这里把客户端声明识别出来，交给能力层用直连执行者忠实执行，结果作为普通
 * 工具结果注入对话，不占私有轮次。
 */
import type { WebToolRequest } from "./WebCapabilityProtocol";

/** 客户端网络工具的两种语义。 */
export type ClientWebToolKind = "search" | "fetch";

/** 一条被识别出来的客户端网络工具声明。 */
export interface ClientWebTool {
	/** 模型实际调用时使用的工具名（托管工具类型会被改写成规范名）。 */
	readonly name: string;
	/** 搜索还是抓取。 */
	readonly kind: ClientWebToolKind;
	/** 原始声明是否为服务端托管工具（`type: "web_search"` 等）。 */
	readonly hosted: boolean;
}

const SEARCH_TOOL_NAMES = new Set(["web_search", "websearch", "litellm_web_search", "search_web"]);
const FETCH_TOOL_NAMES = new Set(["web_fetch", "webfetch", "fetch_web"]);
const MAX_RECENCY_DAYS = 3650;
const DEFAULT_FETCH_INSTRUCTIONS = "Summarize this page and extract the facts the caller needs.";

const SEARCH_DESCRIPTION = "Search the live public web and return the retrieved evidence.";
const FETCH_DESCRIPTION = "Retrieve and inspect one specific public webpage.";

function token(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * 按工具名判断客户端网络工具种类。
 * @param name - 函数工具名（大小写不敏感）
 */
export function clientWebToolKind(name: unknown): ClientWebToolKind | undefined {
	const value = token(name);
	if (value.length === 0) {
		return undefined;
	}
	if (SEARCH_TOOL_NAMES.has(value)) {
		return "search";
	}
	if (FETCH_TOOL_NAMES.has(value)) {
		return "fetch";
	}
	return undefined;
}

/**
 * 按托管工具类型判断种类：`web_search`、`web_search_20250305`、`web_fetch_20250910` 等。
 * @param type - 工具声明的 type 字段
 */
function hostedWebToolKind(type: unknown): ClientWebToolKind | undefined {
	const value = token(type);
	if (!value.startsWith("web_")) {
		return undefined;
	}
	if (value.startsWith("web_search")) {
		return "search";
	}
	if (value.startsWith("web_fetch")) {
		return "fetch";
	}
	return undefined;
}

function hostedToolName(kind: ClientWebToolKind): string {
	return kind === "search" ? "web_search" : "web_fetch";
}

function searchParameters(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			query: { type: "string", description: "A focused web search query." },
			recency_days: {
				type: "integer",
				minimum: 1,
				maximum: MAX_RECENCY_DAYS,
				description: "Optional freshness window in days.",
			},
		},
		required: ["query"],
	};
}

function fetchParameters(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			url: { type: "string", description: "Absolute HTTP or HTTPS URL to inspect." },
			instructions: { type: "string", description: "What facts or sections to extract from the page." },
		},
		required: ["url"],
	};
}

function chatToolDefinition(kind: ClientWebToolKind): Record<string, unknown> {
	return {
		type: "function",
		function: {
			name: hostedToolName(kind),
			description: kind === "search" ? SEARCH_DESCRIPTION : FETCH_DESCRIPTION,
			parameters: kind === "search" ? searchParameters() : fetchParameters(),
		},
	};
}

function anthropicToolDefinition(kind: ClientWebToolKind): Record<string, unknown> {
	return {
		name: hostedToolName(kind),
		description: kind === "search" ? SEARCH_DESCRIPTION : FETCH_DESCRIPTION,
		input_schema: kind === "search" ? searchParameters() : fetchParameters(),
	};
}

/**
 * 归一化 OpenAI 风格的客户端工具列表。
 *
 * 函数工具保持原样，只登记名字与种类；托管工具（`type: "web_search"` 等）在上游无法执行，
 * 因此改写成同名函数工具，让模型至少能发起调用、由能力层接管执行。
 * @param tools - 客户端原始 tools 数组
 */
export function normalizeOpenAIClientWebTools(tools: readonly unknown[]): {
	tools: unknown[];
	clientTools: ClientWebTool[];
} {
	const declared = new Set<string>();
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null) {
			continue;
		}
		const fn = (tool as Record<string, unknown>)["function"];
		const name = typeof fn === "object" && fn !== null ? (fn as Record<string, unknown>)["name"] : undefined;
		if (typeof name === "string") {
			declared.add(name.toLowerCase());
		}
	}
	const normalized: unknown[] = [];
	const clientTools: ClientWebTool[] = [];
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null) {
			normalized.push(tool);
			continue;
		}
		const record = tool as Record<string, unknown>;
		const hostedKind = hostedWebToolKind(record["type"]);
		if (hostedKind !== undefined) {
			const name = hostedToolName(hostedKind);
			// 同名函数工具已经存在时丢掉托管声明，避免同一名字出现两份 schema。
			if (!declared.has(name)) {
				normalized.push(chatToolDefinition(hostedKind));
				clientTools.push({ name: name, kind: hostedKind, hosted: true });
			}
			continue;
		}
		const fn = record["function"];
		if (typeof fn === "object" && fn !== null) {
			const name = (fn as Record<string, unknown>)["name"];
			const kind = clientWebToolKind(name);
			if (kind !== undefined && typeof name === "string") {
				clientTools.push({ name: name, kind: kind, hosted: false });
			}
		}
		normalized.push(tool);
	}
	return { tools: normalized, clientTools: clientTools };
}

/**
 * 归一化 Anthropic 风格的客户端工具列表，规则与 OpenAI 版本一致。
 * @param tools - 客户端原始 tools 数组
 */
export function normalizeAnthropicClientWebTools(tools: readonly unknown[]): {
	tools: unknown[];
	clientTools: ClientWebTool[];
} {
	const declared = new Set<string>();
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null) {
			continue;
		}
		const record = tool as Record<string, unknown>;
		if (hostedWebToolKind(record["type"]) === undefined && typeof record["name"] === "string") {
			declared.add(record["name"].toLowerCase());
		}
	}
	const normalized: unknown[] = [];
	const clientTools: ClientWebTool[] = [];
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null) {
			normalized.push(tool);
			continue;
		}
		const record = tool as Record<string, unknown>;
		const hostedKind = hostedWebToolKind(record["type"]);
		if (hostedKind !== undefined) {
			const name = hostedToolName(hostedKind);
			if (!declared.has(name)) {
				normalized.push(anthropicToolDefinition(hostedKind));
				clientTools.push({ name: name, kind: hostedKind, hosted: true });
			}
			continue;
		}
		const kind = clientWebToolKind(record["name"]);
		if (kind !== undefined && typeof record["name"] === "string") {
			clientTools.push({ name: record["name"], kind: kind, hosted: false });
		}
		normalized.push(tool);
	}
	return { tools: normalized, clientTools: clientTools };
}

/** 一次客户端工具参数归一化的结果。 */
export type ClientWebArgumentParse =
	| {
			/** 参数可用。 */
			readonly ok: true;
			/** 归一化后的执行请求；多查询/多 URL 会展开成多条，按声明顺序执行。 */
			readonly requests: WebToolRequest[];
	  }
	| {
			/** 参数不可用。 */
			readonly ok: false;
			/** 直接作为工具结果注入的错误说明。 */
			readonly error: string;
	  };

/** 单次工具调用最多展开的搜索条数与抓取个数，与常见声明里的 1–4 条上限一致。 */
const MAX_CLIENT_SEARCH_QUERIES = 4;
const MAX_CLIENT_FETCH_URLS = 4;

const SEARCH_FIELDS = ["query", "q", "search_query", "queries", "search_queries", "keywords", "terms", "text"];
const FETCH_FIELDS = ["url", "urls", "link", "href", "url_or_id", "target"];

/**
 * 把一个字段值展开成非空字符串列表：支持单个字符串和字符串数组。
 * @param value
 */
function stringValues(value: unknown): string[] {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? [trimmed] : [];
	}
	if (Array.isArray(value)) {
		const values: string[] = [];
		for (const item of value) {
			if (typeof item === "string" && item.trim().length > 0) {
				values.push(item.trim());
			}
		}
		return values;
	}
	return [];
}

function dedupe(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(value);
	}
	return result;
}

/**
 * 按字段名依次收集候选值；命中不到时退化为「参数对象里唯一一个字符串字段」。
 * 后者用来兼容客户端自定义 schema，例如 `{"search_term": "..."}`。
 * @param record
 * @param keys
 */
function fieldValues(record: Record<string, unknown>, keys: readonly string[]): string[] {
	for (const key of keys) {
		const values = stringValues(record[key]);
		if (values.length > 0) {
			return values;
		}
	}
	for (const value of Object.values(record)) {
		const values = stringValues(value);
		if (values.length > 0) {
			return values;
		}
	}
	return [];
}

function parseRawArguments(rawArguments: unknown): Record<string, unknown> | string {
	if (typeof rawArguments === "string") {
		if (rawArguments.trim().length === 0) {
			return {};
		}
		try {
			const parsed: unknown = JSON.parse(rawArguments);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				return "网络工具参数必须是 JSON 对象，请按工具 schema 重新调用。";
			}
			return parsed as Record<string, unknown>;
		} catch {
			return "网络工具参数不是有效 JSON，请按工具 schema 重新调用。";
		}
	}
	if (typeof rawArguments === "object" && rawArguments !== null && !Array.isArray(rawArguments)) {
		return rawArguments as Record<string, unknown>;
	}
	return {};
}

/**
 * 把客户端工具调用参数归一化成一组搜索或抓取请求。
 *
 * 客户端 schema 各不相同：单数字段（`query` / `q`）、数组字段（`queries: string[]`）、
 * 自定义字段名都有。这里统一抽取语义等价值；数组会展开成多条请求，由调用方按顺序执行并
 * 合并结果（保持「多条查询结果会被合并」的声明语义）。抽不到就返回可注入的错误文本，
 * 让主模型自己纠错。
 * @param kind - 该工具声明的种类
 * @param rawArguments - 模型给出的原始参数
 */
export function parseClientWebArguments(kind: ClientWebToolKind, rawArguments: unknown): ClientWebArgumentParse {
	const record = parseRawArguments(rawArguments);
	if (typeof record === "string") {
		return { ok: false, error: record };
	}

	if (kind === "search") {
		const queries = dedupe(fieldValues(record, SEARCH_FIELDS)).slice(0, MAX_CLIENT_SEARCH_QUERIES);
		if (queries.length === 0) {
			return {
				ok: false,
				error: "网络搜索工具参数缺少 query / queries（或等价的查询字段），请补充查询语句后重新调用。",
			};
		}
		const recency = record["recency_days"] ?? record["freshness_days"] ?? record["max_age_days"];
		const recencyDays =
			typeof recency === "number" && Number.isFinite(recency)
				? Math.min(MAX_RECENCY_DAYS, Math.max(1, Math.trunc(recency)))
				: undefined;
		return {
			ok: true,
			requests: queries.map((query) => ({
				kind: "search" as const,
				query: query,
				...(recencyDays === undefined ? {} : { recencyDays: recencyDays }),
			})),
		};
	}

	const candidates = dedupe(fieldValues(record, FETCH_FIELDS)).slice(0, MAX_CLIENT_FETCH_URLS);
	if (candidates.length === 0) {
		return { ok: false, error: "网页抓取工具参数缺少 url（或 urls），请给出完整 HTTP(S) 地址后重新调用。" };
	}
	const urls: string[] = [];
	for (const candidate of candidates) {
		let parsed: URL;
		try {
			parsed = new URL(candidate);
		} catch {
			return { ok: false, error: "网页抓取工具参数里的 url 不是合法绝对地址，请修正后重新调用。" };
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return { ok: false, error: "网页抓取只支持 HTTP 或 HTTPS 地址。" };
		}
		urls.push(parsed.toString());
	}
	const instructions = stringValues(record["instructions"] ?? record["prompt"] ?? record["question"] ?? record["goal"] ?? record["reason"])[0];
	return {
		ok: true,
		requests: urls.map((url) => ({
			kind: "fetch" as const,
			url: url,
			instructions: instructions !== undefined && instructions.length > 0 ? instructions : DEFAULT_FETCH_INSTRUCTIONS,
		})),
	};
}
