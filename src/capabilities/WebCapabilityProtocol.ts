import { ApiError } from "../core/api/ApiError";

export const PRIVATE_WEB_SEARCH_TOOL_NAME = "litellm__web_search";
export const PRIVATE_WEB_FETCH_TOOL_NAME = "litellm__web_fetch";
const MAX_WEB_SEARCH_RECENCY_DAYS = 3650;

/** Validated request sent to the live-web worker. */
export type WebToolRequest =
	| {
			/** Selects hosted web search. */
			kind: "search";
			/** Focused search query. */
			query: string;
			/** Optional freshness preference in days. */
			recencyDays?: number;
	  }
	| {
			/** Selects retrieval of one exact page. */
			kind: "fetch";
			/** Normalized public HTTP(S) URL. */
			url: string;
			/** Facts or sections the worker should extract. */
			instructions: string;
	  };

/**
 * Returns whether a tool name belongs to the private web protocol.
 * @param name
 */
export function isPrivateWebTool(name: unknown): boolean {
	return name === PRIVATE_WEB_SEARCH_TOOL_NAME || name === PRIVATE_WEB_FETCH_TOOL_NAME;
}

/** Builds the private OpenAI-compatible tool definitions injected into the target model request. */
export function openAIWebTools(): Record<string, unknown>[] {
	return [
		{
			type: "function",
			function: {
				name: PRIVATE_WEB_SEARCH_TOOL_NAME,
				description: "Privately search the live public web using the configured network-enabled execution model.",
				parameters: {
					type: "object",
					additionalProperties: false,
					properties: {
						query: { type: "string", description: "A focused web search query." },
						recency_days: {
							type: "integer",
							minimum: 1,
							maximum: MAX_WEB_SEARCH_RECENCY_DAYS,
							description: "Optional freshness window in days.",
						},
					},
					required: ["query"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: PRIVATE_WEB_FETCH_TOOL_NAME,
				description: "Privately retrieve and inspect a specific public webpage using the configured network-enabled model.",
				parameters: {
					type: "object",
					additionalProperties: false,
					properties: {
						url: { type: "string", description: "Absolute HTTP or HTTPS URL to inspect." },
						instructions: { type: "string", description: "What facts or sections to extract from the page." },
					},
					required: ["url", "instructions"],
				},
			},
		},
	];
}

/** Builds Anthropic-native equivalents of the private web tool definitions. */
export function anthropicWebTools(): Record<string, unknown>[] {
	return openAIWebTools().map((tool) => {
		const functionDefinition = tool["function"] as Record<string, unknown>;
		return {
			name: functionDefinition["name"],
			description: functionDefinition["description"],
			input_schema: functionDefinition["parameters"],
		};
	});
}

/**
 * Validates and normalizes model-authored arguments for a known private web tool.
 * @param toolName
 * @param rawArguments
 * @throws {ApiError} When the tool name or arguments violate the private protocol.
 */
export function parseWebArguments(toolName: string, rawArguments: string): WebToolRequest {
	if (!isPrivateWebTool(toolName)) {
		throw ApiError.badRequest(`未知的网络工具: ${toolName}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(rawArguments);
	} catch {
		throw ApiError.badRequest("网络工具参数不是有效 JSON");
	}
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	switch (toolName) {
		case PRIVATE_WEB_SEARCH_TOOL_NAME: {
			const query = typeof record["query"] === "string" ? record["query"].trim() : "";
			if (!query) {
				throw ApiError.badRequest("网络搜索参数缺少 query");
			}
			const rawDays = record["recency_days"];
			return {
				kind: "search",
				query: query,
				...(typeof rawDays === "number" && Number.isFinite(rawDays)
					? { recencyDays: Math.min(MAX_WEB_SEARCH_RECENCY_DAYS, Math.max(1, Math.trunc(rawDays))) }
					: {}),
			};
		}
		case PRIVATE_WEB_FETCH_TOOL_NAME: {
			const url = typeof record["url"] === "string" ? record["url"].trim() : "";
			const instructions = typeof record["instructions"] === "string" ? record["instructions"].trim() : "";
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw ApiError.badRequest("网页 fetch 参数必须包含有效 URL");
			}
			if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !instructions) {
				throw ApiError.badRequest("网页 fetch 参数缺少有效 url 或 instructions");
			}
			return { kind: "fetch", url: parsed.toString(), instructions: instructions };
		}
		default:
			throw ApiError.badRequest(`未知的网络工具: ${toolName}`);
	}
}

/**
 * Extracts the first assistant message from an OpenAI-compatible completion.
 * @param result
 * @throws {ApiError} When the provider response has no assistant message.
 */
export function extractAssistant(result: Record<string, unknown>): Record<string, unknown> {
	const choices = result["choices"];
	const choice = Array.isArray(choices) ? choices[0] : undefined;
	const message = typeof choice === "object" && choice !== null ? (choice as Record<string, unknown>)["message"] : undefined;
	if (typeof message !== "object" || message === null) {
		throw ApiError.unavailable("联网执行模型没有返回可解析的 assistant message");
	}
	return message as Record<string, unknown>;
}

/**
 * Serializes an Anthropic tool_use input into the shared JSON argument format.
 * @param input
 */
export function anthropicInput(input: unknown): string {
	return typeof input === "string" ? input : JSON.stringify(input ?? {});
}
