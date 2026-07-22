/**
 * SearchTools 端点
 *
 * GET /v1/search/tools：返回当前可用的搜索工具清单（config search_tools + DB 表合并），
 * 对齐 Python litellm/proxy/search_endpoints/endpoints.py list_search_tools。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { getConfig } from "../core/config";
import { LiteLLM_SearchToolsTable } from "../db/schema/searchTools";
import type { DrizzleDb } from "../core/db/Database";

interface SearchToolItem {
	readonly search_tool_name: string;
	readonly search_provider: string | null;
	readonly description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从单条 search tool 配置/DB 记录提取响应项（对齐 Python tool_info 构造）
 * @param tool
 */
function toSearchToolItem(tool: Record<string, unknown>): SearchToolItem | null {
	const name = tool["search_tool_name"];
	if (typeof name !== "string" || name.length === 0) {
		return null;
	}
	const params = isRecord(tool["litellm_params"]) ? tool["litellm_params"] : {};
	const provider = typeof params["search_provider"] === "string" ? params["search_provider"] : null;
	const description = typeof tool["description"] === "string" ? tool["description"] : undefined;
	return {
		search_tool_name: name,
		search_provider: provider,
		...(description !== undefined ? { description: description } : {}),
	};
}

/**
 * @param router
 * @param db - Drizzle DB 实例（读取 LiteLLM_SearchToolsTable）
 */
export function registerSearchToolsRoutes(router: Router, db?: DrizzleDb): void {
	registerRoute(router, { method: "get", path: "/v1/search/tools" }, async () => {
		// PY: config 中的 search_tools（llm_router.search_tools）
		const configTools = getConfig().routerSettings.search_tools ?? [];
		const items: SearchToolItem[] = [];
		const seen = new Set<string>();
		for (const tool of configTools) {
			if (!isRecord(tool)) {
				continue;
			}
			const item = toSearchToolItem(tool);
			if (item && !seen.has(item.search_tool_name)) {
				seen.add(item.search_tool_name);
				items.push(item);
			}
		}
		// PY: DB LiteLLM_SearchToolsTable 中的 search tools（_init_search_tools_in_db 合并）
		if (db) {
			const rows = await db.select().from(LiteLLM_SearchToolsTable);
			for (const row of rows) {
				if (seen.has(row.search_tool_name)) {
					continue;
				}
				const item = toSearchToolItem({
					search_tool_name: row.search_tool_name,
					litellm_params: row.litellm_params,
				});
				if (item) {
					seen.add(item.search_tool_name);
					items.push(item);
				}
			}
		}
		return { object: "list", data: items };
	});

	registerRoute(router, { method: "post", path: "/v1/search/tools" }, notImpl("SearchTools 创建"));
	registerRoute(router, { method: "put", path: "/v1/search/tools/:id" }, notImpl("SearchTools 更新"));
	registerRoute(router, { method: "delete", path: "/v1/search/tools/:id" }, notImpl("SearchTools 删除"));
}

function notImpl(name: string) {
	return () => {
		throw new ApiError(503, `${name} 暂未实现`);
	};
}
