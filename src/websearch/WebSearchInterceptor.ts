// Google Programmable Search Engine 的本地 web_search 工具拦截与 continuation 构造。

import { ApiError } from "../core/api/ApiError";
import type { ServiceConfig } from "../core/config";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("WebSearch");
const GOOGLE_PSE_URL = "https://www.googleapis.com/customsearch/v1";
const LOCAL_WEB_SEARCH_NAMES = new Set(["litellm_web_search", "WebSearch", "web_search"]);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_QUERIES = 4;
const DEFAULT_MAX_QUERY_LENGTH = 512;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_TITLE_LENGTH = 200;
const DEFAULT_MAX_LINK_LENGTH = 2_048;
const DEFAULT_MAX_SNIPPET_LENGTH = 1_000;
const DEFAULT_MAX_INJECTED_CHARS = 12_000;

/** Google PSE 搜索结果项。 */
export interface SearchResultItem {
	/**
	 *
	 */
	readonly title: string;
	/**
	 *
	 */
	readonly link: string;
	/**
	 *
	 */
	readonly snippet: string;
}

/** Google PSE 搜索响应。 */
export interface SearchResponse {
	/**
	 *
	 */
	readonly items: SearchResultItem[];
	/**
	 *
	 */
	readonly totalResults: number;
}

/** 一次由模型发起的本地搜索工具调用。 */
export interface WebSearchCall {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly name: string;
	/**
	 *
	 */
	readonly query: string;
	/**
	 *
	 */
	readonly input: Record<string, unknown>;
}

/** 已解析且带安全上限的 Google PSE 配置。 */
export interface GooglePseSearchConfig {
	/**
	 *
	 */
	readonly apiKey: string;
	/**
	 *
	 */
	readonly engineId: string;
	/**
	 *
	 */
	readonly timeoutMs: number;
	/**
	 *
	 */
	readonly maxQueries: number;
	/**
	 *
	 */
	readonly maxQueryLength: number;
	/**
	 *
	 */
	readonly maxResults: number;
	/**
	 *
	 */
	readonly maxTitleLength: number;
	/**
	 *
	 */
	readonly maxLinkLength: number;
	/**
	 *
	 */
	readonly maxSnippetLength: number;
	/**
	 *
	 */
	readonly maxInjectedChars: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number, maximum?: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		return fallback;
	}
	return maximum === undefined ? value : Math.min(value, maximum);
}

function nonEmptyString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : value.slice(0, maxLength);
}

/**
 * 从 YAML 运行时配置解析本地 Google PSE 拦截参数。
 * 只有 pre-call checks、websearch callback 参数和 google_pse search tool 同时存在时启用。
 * @param config
 * @param provider
 * @throws {ApiError} 已启用本地 Google PSE 但凭据不完整
 */
export function resolveGooglePseSearchConfig(config: ServiceConfig, provider?: string): GooglePseSearchConfig | undefined {
	if (config.routerSettings.enable_pre_call_checks !== true) {
		return undefined;
	}
	const rawInterception = config.litellmSettingsRaw?.["websearch_interception_params"];
	if (!isRecord(rawInterception)) {
		return undefined;
	}
	const enabledProviders = rawInterception["enabled_providers"];
	if (Array.isArray(enabledProviders)) {
		if (typeof provider !== "string" || !enabledProviders.includes(provider)) {
			return undefined;
		}
	}
	const configuredToolName = rawInterception["search_tool_name"];
	const searchTool = config.routerSettings.search_tools?.find((candidate) => {
		if (typeof configuredToolName === "string" && candidate["search_tool_name"] !== configuredToolName) {
			return false;
		}
		const params = isRecord(candidate["litellm_params"]) ? candidate["litellm_params"] : undefined;
		return params?.["search_provider"] === "google_pse";
	});
	if (!searchTool) {
		return undefined;
	}
	const toolParams = isRecord(searchTool["litellm_params"]) ? searchTool["litellm_params"] : {};
	const apiKey = nonEmptyString(
		toolParams["api_key"],
		toolParams["google_pse_api_key"],
		rawInterception["google_pse_api_key"],
		process.env["GOOGLE_PSE_API_KEY"],
	);
	const engineId = nonEmptyString(
		toolParams["search_engine_id"],
		toolParams["google_pse_engine_id"],
		rawInterception["google_pse_engine_id"],
		process.env["GOOGLE_PSE_ENGINE_ID"],
	);
	if (!apiKey) {
		throw new ApiError(401, "Google PSE API 凭据未配置", "web_search_auth_error");
	}
	if (!engineId) {
		throw ApiError.badRequest("Google PSE 搜索引擎 ID 未配置");
	}
	return {
		apiKey: apiKey,
		engineId: engineId,
		timeoutMs: positiveInteger(rawInterception["timeout_ms"], DEFAULT_TIMEOUT_MS),
		maxQueries: positiveInteger(rawInterception["max_queries"], DEFAULT_MAX_QUERIES, 10),
		maxQueryLength: positiveInteger(rawInterception["max_query_length"], DEFAULT_MAX_QUERY_LENGTH, 4_096),
		maxResults: positiveInteger(rawInterception["max_results"], DEFAULT_MAX_RESULTS, 10),
		maxTitleLength: positiveInteger(rawInterception["max_title_length"], DEFAULT_MAX_TITLE_LENGTH, 1_000),
		maxLinkLength: positiveInteger(rawInterception["max_link_length"], DEFAULT_MAX_LINK_LENGTH, 8_192),
		maxSnippetLength: positiveInteger(rawInterception["max_snippet_length"], DEFAULT_MAX_SNIPPET_LENGTH, 4_000),
		maxInjectedChars: positiveInteger(rawInterception["max_injected_chars"], DEFAULT_MAX_INJECTED_CHARS, 100_000),
	};
}

function mapGoogleStatus(status: number): ApiError {
	switch (status) {
		case 400:
			return new ApiError(400, "Google PSE 搜索请求无效", "web_search_invalid_request");
		case 401:
			return new ApiError(401, "Google PSE 搜索认证失败", "web_search_auth_error");
		case 403:
			return new ApiError(403, "Google PSE 搜索被拒绝", "web_search_permission_error");
		case 429:
			return new ApiError(429, "Google PSE 搜索请求过多", "web_search_rate_limit_error");
		default:
			return new ApiError(status >= 500 && status <= 599 ? status : 502, "Google PSE 搜索服务返回异常", "web_search_upstream_error");
	}
}

function parseGoogleResponse(value: unknown, config: GooglePseSearchConfig): SearchResponse {
	if (!isRecord(value)) {
		throw new ApiError(502, "Google PSE 搜索响应格式无效", "web_search_invalid_response");
	}
	const rawItems = value["items"];
	if (rawItems !== undefined && !Array.isArray(rawItems)) {
		throw new ApiError(502, "Google PSE 搜索响应格式无效", "web_search_invalid_response");
	}
	const items: SearchResultItem[] = [];
	for (const rawItem of (rawItems ?? []).slice(0, config.maxResults)) {
		if (
			!isRecord(rawItem) ||
			typeof rawItem["title"] !== "string" ||
			typeof rawItem["link"] !== "string" ||
			typeof rawItem["snippet"] !== "string"
		) {
			throw new ApiError(502, "Google PSE 搜索响应格式无效", "web_search_invalid_response");
		}
		items.push({
			title: truncate(rawItem["title"], config.maxTitleLength),
			link: truncate(rawItem["link"], config.maxLinkLength),
			snippet: truncate(rawItem["snippet"], config.maxSnippetLength),
		});
	}
	const searchInformation = isRecord(value["searchInformation"]) ? value["searchInformation"] : undefined;
	const totalRaw = searchInformation?.["totalResults"];
	const totalResults = typeof totalRaw === "string" && /^\d+$/.test(totalRaw) ? Number(totalRaw) : items.length;
	return { items: items, totalResults: Number.isSafeInteger(totalResults) ? totalResults : items.length };
}

/**
 * 执行单次 Google PSE 搜索，不记录凭据或完整查询。
 * @param query
 * @param config
 * @param signal
 */
export async function executeGooglePseSearch(query: string, config: GooglePseSearchConfig, signal?: AbortSignal): Promise<SearchResponse> {
	const normalizedQuery = query.trim();
	if (!normalizedQuery) {
		throw ApiError.badRequest("web_search query 不能为空");
	}
	if (normalizedQuery.length > config.maxQueryLength) {
		throw ApiError.badRequest(`web_search query 超过 ${config.maxQueryLength} 字符上限`);
	}
	if (signal?.aborted) {
		throw new ApiError(499, "Google PSE 搜索已取消", "web_search_aborted");
	}

	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, config.timeoutMs);
	const abortFromCaller = (): void => controller.abort();
	signal?.addEventListener("abort", abortFromCaller, { once: true });

	const url = new URL(GOOGLE_PSE_URL);
	url.searchParams.set("key", config.apiKey);
	url.searchParams.set("cx", config.engineId);
	url.searchParams.set("q", normalizedQuery);
	url.searchParams.set("num", String(config.maxResults));
	logger.info("执行 Google PSE 搜索", { queryLength: normalizedQuery.length, maxResults: config.maxResults });

	try {
		const response = await fetch(url, { method: "GET", signal: controller.signal });
		if (!response.ok) {
			throw mapGoogleStatus(response.status);
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new ApiError(502, "Google PSE 搜索响应不是有效 JSON", "web_search_invalid_response");
		}
		return parseGoogleResponse(body, config);
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		if (controller.signal.aborted) {
			if (timedOut) {
				throw new ApiError(504, "Google PSE 搜索超时", "web_search_timeout");
			}
			throw new ApiError(499, "Google PSE 搜索已取消", "web_search_aborted");
		}
		throw new ApiError(502, "Google PSE 搜索连接失败", "web_search_connection_error");
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abortFromCaller);
	}
}

function isLocalOpenAITool(tool: unknown, name: string): boolean {
	if (!isRecord(tool) || tool["type"] !== "function" || !isRecord(tool["function"])) {
		return false;
	}
	return tool["function"]["name"] === name && LOCAL_WEB_SEARCH_NAMES.has(name);
}

function parseToolInput(value: unknown): Record<string, unknown> {
	if (isRecord(value)) {
		return value;
	}
	if (typeof value !== "string") {
		throw ApiError.badRequest("web_search 工具参数必须是 JSON 对象");
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (!isRecord(parsed)) {
			throw new Error("not object");
		}
		return parsed;
	} catch {
		throw ApiError.badRequest("web_search 工具参数不是有效 JSON 对象");
	}
}

function buildSearchCall(id: unknown, name: unknown, rawInput: unknown): WebSearchCall {
	if (typeof id !== "string" || !id || typeof name !== "string") {
		throw ApiError.badRequest("web_search 工具调用缺少 id 或 name");
	}
	const input = parseToolInput(rawInput);
	if (typeof input["query"] !== "string" || input["query"].trim().length === 0) {
		throw ApiError.badRequest("web_search 工具调用缺少 query");
	}
	return { id: id, name: name, query: input["query"], input: input };
}

/**
 * 从 OpenAI Chat Completion 响应提取本地 web_search 调用。
 * @param response
 * @param requestTools
 */
export function extractOpenAIWebSearchCalls(response: unknown, requestTools: unknown[]): WebSearchCall[] {
	if (!isRecord(response) || !Array.isArray(response["choices"])) {
		return [];
	}
	const firstChoice = response["choices"][0];
	if (!isRecord(firstChoice) || !isRecord(firstChoice["message"]) || !Array.isArray(firstChoice["message"]["tool_calls"])) {
		return [];
	}
	const calls: WebSearchCall[] = [];
	for (const rawCall of firstChoice["message"]["tool_calls"]) {
		if (!isRecord(rawCall) || rawCall["type"] !== "function" || !isRecord(rawCall["function"])) {
			return [];
		}
		const name = rawCall["function"]["name"];
		if (typeof name !== "string" || !requestTools.some((tool) => isLocalOpenAITool(tool, name))) {
			return [];
		}
		calls.push(buildSearchCall(rawCall["id"], name, rawCall["function"]["arguments"]));
	}
	return calls;
}

function isAnthropicHostedSearchTool(tool: Record<string, unknown>): boolean {
	return typeof tool["type"] === "string" && (tool["type"] === "web_search" || tool["type"].startsWith("web_search_"));
}

function localAnthropicToolNames(tools: unknown[]): Set<string> {
	const names = new Set<string>();
	for (const tool of tools) {
		if (!isRecord(tool) || isAnthropicHostedSearchTool(tool)) {
			continue;
		}
		if (typeof tool["name"] === "string" && LOCAL_WEB_SEARCH_NAMES.has(tool["name"]) && isRecord(tool["input_schema"])) {
			names.add(tool["name"]);
		}
	}
	return names;
}

/**
 * 从 Anthropic Messages 响应提取本地工具调用；原生 hosted search 工具始终跳过。
 * @param response
 * @param requestTools
 */
export function extractAnthropicWebSearchCalls(response: unknown, requestTools: unknown[]): WebSearchCall[] {
	if (!isRecord(response) || !Array.isArray(response["content"])) {
		return [];
	}
	const allowedNames = localAnthropicToolNames(requestTools);
	const calls: WebSearchCall[] = [];
	for (const block of response["content"]) {
		if (!isRecord(block) || block["type"] !== "tool_use") {
			continue;
		}
		if (typeof block["name"] !== "string" || !allowedNames.has(block["name"])) {
			return [];
		}
		calls.push(buildSearchCall(block["id"], block["name"], block["input"]));
	}
	return calls;
}

/**
 * 构造 OpenAI assistant tool_calls + tool result continuation。
 * @param response
 * @param calls
 * @param results
 * @throws {ApiError} 模型响应缺少标准 assistant message
 */
export function buildOpenAISearchContinuation(response: unknown, calls: WebSearchCall[], results: string[]): Record<string, unknown>[] {
	const choices = isRecord(response) && Array.isArray(response["choices"]) ? response["choices"] : [];
	const firstChoice = isRecord(choices[0]) ? choices[0] : undefined;
	const assistantMessage = firstChoice && isRecord(firstChoice["message"]) ? firstChoice["message"] : undefined;
	if (!assistantMessage) {
		throw new ApiError(502, "模型 web_search 响应格式无效", "web_search_invalid_model_response");
	}
	return [
		{ ...assistantMessage },
		...calls.map((call, index) => ({ role: "tool", tool_call_id: call.id, content: results[index] ?? "No search results found." })),
	];
}

/**
 * 构造 Anthropic assistant tool_use + user tool_result continuation。
 * @param response
 * @param calls
 * @param results
 */
export function buildAnthropicSearchContinuation(response: unknown, calls: WebSearchCall[], results: string[]): Record<string, unknown>[] {
	const content = isRecord(response) && Array.isArray(response["content"]) ? response["content"] : [];
	return [
		{ role: "assistant", content: content },
		{
			role: "user",
			content: calls.map((call, index) => ({
				type: "tool_result",
				tool_use_id: call.id,
				content: results[index] ?? "No search results found.",
			})),
		},
	];
}

/**
 * 将标准结果格式化为工具结果文本，并施加单次注入总大小上限。
 * @param items
 * @param maxChars
 */
export function formatSearchResults(items: SearchResultItem[], maxChars: number): string {
	const fullText =
		items.length === 0
			? "No search results found."
			: items.map((item) => `Title: ${item.title}\nURL: ${item.link}\nSnippet: ${item.snippet}`).join("\n\n");
	return truncate(fullText, maxChars);
}

/**
 * 并行执行一组搜索，并为每个工具调用分配注入大小预算。
 * @param calls
 * @param config
 * @param signal
 */
export async function executeWebSearchCalls(
	calls: WebSearchCall[],
	config: GooglePseSearchConfig,
	signal?: AbortSignal,
): Promise<string[]> {
	if (calls.length > config.maxQueries) {
		throw ApiError.badRequest(`web_search 调用数量超过 ${config.maxQueries} 次上限`);
	}
	const perResultLimit = Math.max(1, Math.floor(config.maxInjectedChars / Math.max(calls.length, 1)));
	const batchController = new AbortController();
	const abortBatch = (): void => batchController.abort();
	if (signal?.aborted) {
		batchController.abort();
	} else {
		signal?.addEventListener("abort", abortBatch, { once: true });
	}
	try {
		const responses = await Promise.all(
			calls.map((call) =>
				executeGooglePseSearch(call.query, config, batchController.signal).catch((error: unknown) => {
					batchController.abort();
					throw error;
				}),
			),
		);
		return responses.map((response) => formatSearchResults(response.items, perResultLimit));
	} finally {
		signal?.removeEventListener("abort", abortBatch);
	}
}

/**
 * 为最终 usage 增加本地搜索次数，供 Spend metadata.additional_usage_values 记录。
 * @param response
 * @param searchCount
 */
export function addWebSearchUsage(response: Record<string, unknown>, searchCount: number): void {
	if (searchCount <= 0) {
		return;
	}
	const usage = isRecord(response["usage"]) ? response["usage"] : {};
	const serverToolUse = isRecord(usage["server_tool_use"]) ? usage["server_tool_use"] : {};
	const existingCount = serverToolUse["web_search_requests"];
	serverToolUse["web_search_requests"] = (typeof existingCount === "number" && existingCount >= 0 ? existingCount : 0) + searchCount;
	usage["server_tool_use"] = serverToolUse;
	response["usage"] = usage;
}

/**
 * 聚合 agentic loop 两次模型调用的 usage，再增加本地搜索次数。
 * @param finalResponse
 * @param initialResponse
 * @param searchCount
 */
export function mergeAgenticLoopUsage(
	finalResponse: Record<string, unknown>,
	initialResponse: Record<string, unknown>,
	searchCount: number,
): void {
	const finalUsage = isRecord(finalResponse["usage"]) ? finalResponse["usage"] : {};
	const initialUsage = isRecord(initialResponse["usage"]) ? initialResponse["usage"] : {};
	for (const field of [
		"prompt_tokens",
		"completion_tokens",
		"total_tokens",
		"input_tokens",
		"output_tokens",
		"cache_creation_input_tokens",
		"cache_read_input_tokens",
		"cost",
	]) {
		const initialValue = initialUsage[field];
		const finalValue = finalUsage[field];
		if (typeof initialValue === "number") {
			finalUsage[field] = initialValue + (typeof finalValue === "number" ? finalValue : 0);
		}
	}
	const initialServerToolUse = isRecord(initialUsage["server_tool_use"]) ? initialUsage["server_tool_use"] : undefined;
	const finalServerToolUse = isRecord(finalUsage["server_tool_use"]) ? finalUsage["server_tool_use"] : {};
	const initialHostedCount = initialServerToolUse?.["web_search_requests"];
	if (typeof initialHostedCount === "number" && initialHostedCount >= 0) {
		const finalHostedCount = finalServerToolUse["web_search_requests"];
		finalServerToolUse["web_search_requests"] =
			initialHostedCount + (typeof finalHostedCount === "number" && finalHostedCount >= 0 ? finalHostedCount : 0);
	}
	finalUsage["server_tool_use"] = finalServerToolUse;
	finalResponse["usage"] = finalUsage;
	addWebSearchUsage(finalResponse, searchCount);
}
