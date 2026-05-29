/**
 * WebSearch 拦截器
 *
 * 拦截 web_search 工具调用，查询 Google PSE（Programmable Search Engine），
 * 将搜索结果注入到消息上下文中。
 *
 * 当前为桩实现，完整 Google PSE 集成待后续接入。
 */

import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("WebSearch");

/** Google PSE 搜索结果项 */
export interface SearchResultItem {
	/** 搜索结果标题 */
	readonly title: string;
	/** 搜索结果链接 */
	readonly link: string;
	/** 搜索结果摘要 */
	readonly snippet: string;
}

/** 搜索响应 */
export interface SearchResponse {
	/** 搜索结果项列表 */
	readonly items: SearchResultItem[];
	/** 搜索结果总数 */
	readonly totalResults: number;
}

/** 工具定义 */
interface ToolDef {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

/** 消息定义 */
interface MessageLike {
	role: string;
	content: string | null;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
}

// ========== 公开 API ==========

/**
 * 检测消息中是否包含 web_search 工具调用
 * @param messages - 消息列表
 * @param tools - 可用的工具定义列表
 * @returns 是否包含 web_search 调用
 */
export function detectWebSearchCall(messages: MessageLike[], tools: ToolDef[]): boolean {
	// 检查 tools 定义中是否有 web_search
	const hasWebSearchTool = tools.some((t) => t.type === "function" && t.function.name === "web_search");
	if (!hasWebSearchTool) {
		return false;
	}

	// 检查消息中是否有 web_search 工具调用
	for (const msg of messages) {
		if (msg.role === "assistant" && msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				if (tc.function.name === "web_search") {
					return true;
				}
			}
		}
	}

	return false;
}

/**
 * 执行 web 搜索
 *
 * 当前为桩实现，返回空结果。
 * 完整实现将使用 Google PSE API：
 * GET https://www.googleapis.com/customsearch/v1?key={apiKey}&cx={engineId}&q={query}
 * @param query - 搜索查询
 * @param _apiKey - Google PSE API 密钥
 * @param _engineId - Google PSE 搜索引擎 ID
 * @returns 搜索结果
 */
export async function executeWebSearch(query: string, _apiKey?: string, _engineId?: string): Promise<SearchResponse> {
	logger.info(`web_search 执行: query="${query}"`);

	// 桩实现：返回空结果
	// TODO: 接入 Google PSE
	return {
		items: [],
		totalResults: 0,
	};
}

/**
 * 将搜索结果注入到消息上下文中
 *
 * 将搜索结果格式化为文本，附加到最后一个 user 消息末尾。
 * @param messages - 消息列表
 * @param searchResults - 搜索结果
 * @returns 修改后的消息列表
 */
export function injectSearchResults(messages: MessageLike[], searchResults: SearchResultItem[]): MessageLike[] {
	if (searchResults.length === 0) {
		return messages;
	}

	// 格式化搜索结果
	const formattedResults = searchResults
		.map((item, i) => `[${i + 1}] ${item.title}\n  URL: ${item.link}\n  摘要: ${item.snippet}`)
		.join("\n\n");

	const contextBlock = `\n\n以下为搜索到的网页结果:\n${formattedResults}`;

	// 追加到最后一个 user 消息
	const result = [...messages];
	for (let i = result.length - 1; i >= 0; i--) {
		const msg = result[i];
		if (msg && msg.role === "user" && msg.content !== null) {
			result[i] = { ...msg, content: msg.content + contextBlock };
			break;
		}
	}

	return result;
}
