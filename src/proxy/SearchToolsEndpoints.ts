/**
 * SearchTools 端点
 *
 * 对齐 Python litellm/proxy/search_endpoints/endpoints.py：
 * - GET /v1/search/tools：返回当前可用的搜索工具清单（config search_tools + DB 表合并）
 * - GET /search_tools/list：WebUI 管理页列表（含 ID、时间戳与 is_from_config 标记）
 * - GET /search_tools/ui/available_providers：表单可选的搜索供应商
 * - POST/PUT/DELETE /search_tools[/:id]：DB 中的搜索工具增删改
 * - POST /search_tools/test_connection：用提交的凭据发起一次真实查询
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

/** 表单可选择、且本代理能够实际执行的搜索供应商。 */
const AVAILABLE_SEARCH_PROVIDERS = [
	{ provider_name: "google_pse", ui_friendly_name: "Google PSE" },
] as const;

const GOOGLE_PSE_URL = "https://www.googleapis.com/customsearch/v1";
const CONNECTION_TEST_QUERY = "LiteLLM search tool connection test";
const CONNECTION_TEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取路径参数（Express 类型允许数组/undefined，这里统一成非空字符串）。
 * @param req - 请求对象
 * @param name - 路径参数名
 * @throws {ApiError} 参数缺失
 */
function pathParam(req: { params: Record<string, string | string[] | undefined> }, name: string): string {
	const raw = req.params[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (!value) {
		throw ApiError.badRequest(`缺少路径参数 ${name}`);
	}
	return value;
}

function nonEmptyString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}

/**
 * 从单条 search tool 配置/DB 记录提取响应项（对齐 Python tool_info 构造）
 * @param tool - config 或 DB 记录
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
 * 管理页条目：config 工具没有数据库 ID，用 is_from_config 标记只读。
 * @param tool - config 中的 search_tools 条目
 */
function configToolEntry(tool: Record<string, unknown>): Record<string, unknown> | null {
	const item = toSearchToolItem(tool);
	if (!item) {
		return null;
	}
	const info = isRecord(tool["search_tool_info"]) ? tool["search_tool_info"] : undefined;
	return {
		search_tool_name: item.search_tool_name,
		litellm_params: isRecord(tool["litellm_params"]) ? tool["litellm_params"] : {},
		...(info !== undefined ? { search_tool_info: info } : {}),
		is_from_config: true,
	};
}

/**
 * 数据库行转管理页条目。
 * @param row - LiteLLM_SearchToolsTable 行
 */
function databaseToolEntry(row: typeof LiteLLM_SearchToolsTable.$inferSelect): Record<string, unknown> {
	return {
		search_tool_id: row.search_tool_id,
		search_tool_name: row.search_tool_name,
		litellm_params: row.litellm_params,
		...(row.search_tool_info ? { search_tool_info: row.search_tool_info } : {}),
		created_at: row.created_at.toISOString(),
		updated_at: row.updated_at.toISOString(),
		is_from_config: false,
	};
}

/**
 * 校验 `{ search_tool: {...} }` 请求体并抽出可落库的字段。
 * @param body - 原始请求体
 * @throws {ApiError} 字段缺失或格式非法
 */
function readSearchToolPayload(body: unknown): {
	search_tool_name: string;
	litellm_params: Record<string, unknown>;
	search_tool_info?: Record<string, unknown>;
} {
	const raw = isRecord(body) && isRecord(body["search_tool"]) ? body["search_tool"] : body;
	if (!isRecord(raw)) {
		throw ApiError.badRequest("请求体必须包含 search_tool 对象");
	}
	const name = nonEmptyString(raw["search_tool_name"]);
	if (!name) {
		throw ApiError.badRequest("search_tool_name 不能为空");
	}
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		throw ApiError.badRequest("search_tool_name 只能包含字母、数字、下划线和连字符");
	}
	const params = raw["litellm_params"];
	if (!isRecord(params)) {
		throw ApiError.badRequest("litellm_params 必须是对象");
	}
	const provider = nonEmptyString(params["search_provider"]);
	if (!provider) {
		throw ApiError.badRequest("litellm_params.search_provider 不能为空");
	}
	const info = isRecord(raw["search_tool_info"]) ? raw["search_tool_info"] : undefined;
	return { search_tool_name: name, litellm_params: { ...params, search_provider: provider }, search_tool_info: info };
}

/** 单次 Google PSE 查询结果。 */
interface SearchResultEntry {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
}

/** 供应商调用失败（用于把错误统一成 test_connection 的 status=error）。 */
class ProviderFailure extends Error {
	readonly errorType: string;
	constructor(message: string, errorType: string) {
		super(message);
		this.errorType = errorType;
	}
}

/**
 * 解析 Google PSE 凭据（参数优先，其次环境变量）。
 * @param params - search_tool.litellm_params
 * @throws {ProviderFailure} 凭据缺失
 */
function googlePseCredentials(params: Record<string, unknown>): { apiKey: string; engineId: string; base: string } {
	const apiKey = nonEmptyString(params["api_key"], params["google_pse_api_key"], process.env["GOOGLE_PSE_API_KEY"]);
	if (!apiKey) {
		throw new ProviderFailure("缺少 Google PSE API Key", "AuthenticationError");
	}
	const engineId = nonEmptyString(
		params["search_engine_id"],
		params["google_pse_engine_id"],
		params["api_base"],
		process.env["GOOGLE_PSE_ENGINE_ID"],
	);
	if (!engineId) {
		throw new ProviderFailure("缺少 Google 搜索引擎 ID", "BadRequestError");
	}
	return { apiKey: apiKey, engineId: engineId, base: nonEmptyString(params["google_pse_api_base"]) ?? GOOGLE_PSE_URL };
}

/**
 * 调用 Google PSE 执行一次查询。
 * @param params - search_tool.litellm_params
 * @param query - 查询词
 * @param maxResults - 返回条数上限（1-10）
 */
async function queryGooglePse(params: Record<string, unknown>, query: string, maxResults: number): Promise<SearchResultEntry[]> {
	const { apiKey, engineId, base } = googlePseCredentials(params);
	const url = new URL(base);
	url.searchParams.set("key", apiKey);
	url.searchParams.set("cx", engineId);
	url.searchParams.set("q", query);
	url.searchParams.set("num", String(Math.min(Math.max(maxResults, 1), 10)));
	let response: Response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS) });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new ProviderFailure(`连接搜索供应商失败: ${message}`, "ConnectionError");
	}
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		let message = `搜索供应商返回 ${response.status}`;
		try {
			const parsed: unknown = JSON.parse(detail);
			const error = isRecord(parsed) && isRecord(parsed["error"]) ? parsed["error"] : undefined;
			const parsedMessage = error?.["message"] ?? (isRecord(parsed) ? parsed["message"] : undefined);
			if (typeof parsedMessage === "string" && parsedMessage.length > 0) {
				message = parsedMessage;
			}
		} catch {
			if (detail.trim().length > 0) {
				message = `${message}: ${detail.trim().slice(0, 200)}`;
			}
		}
		throw new ProviderFailure(message, response.status === 401 || response.status === 403 ? "AuthenticationError" : "ProviderError");
	}
	const payload: unknown = await response.json();
	const items = isRecord(payload) && Array.isArray(payload["items"]) ? payload["items"] : [];
	return items.filter(isRecord).map((item) => ({
		title: String(item["title"] ?? ""),
		url: String(item["link"] ?? ""),
		snippet: String(item["snippet"] ?? ""),
	}));
}

/**
 * 用提交的参数调用一次 Google PSE，验证凭据可用。
 * @param params - search_tool.litellm_params
 */
async function testGooglePseConnection(
	params: Record<string, unknown>,
): Promise<{ status: "success" | "error"; message: string; test_query?: string; results_count?: number; error_type?: string }> {
	const provider = nonEmptyString(params["search_provider"]);
	if (provider !== "google_pse") {
		return { status: "error", message: `不支持的搜索供应商: ${provider ?? "未指定"}`, error_type: "BadRequestError" };
	}
	try {
		const results = await queryGooglePse(params, CONNECTION_TEST_QUERY, 3);
		return {
			status: "success",
			message: "连接成功，第 1 页有效结果已返回",
			test_query: CONNECTION_TEST_QUERY,
			results_count: results.length,
		};
	} catch (error) {
		if (error instanceof ProviderFailure) {
			return { status: "error", message: error.message, error_type: error.errorType };
		}
		return { status: "error", message: `连接搜索供应商失败: ${String(error)}`, error_type: "ConnectionError" };
	}
}

/**
 * 按名称查找搜索工具：DB 优先，其次 YAML 配置（对齐 Python 合并语义）。
 * @param db - Drizzle DB 实例
 * @param name - search_tool_name
 */
async function findSearchTool(db: DrizzleDb | undefined, name: string): Promise<Record<string, unknown> | undefined> {
	if (db) {
		const [row] = await db
			.select()
			.from(LiteLLM_SearchToolsTable)
			.where(eq(LiteLLM_SearchToolsTable.search_tool_name, name));
		if (row) {
			return { search_tool_name: row.search_tool_name, litellm_params: row.litellm_params };
		}
	}
	const configTool = (getConfig().routerSettings.search_tools ?? []).find(
		(tool) => isRecord(tool) && tool["search_tool_name"] === name,
	);
	return isRecord(configTool) ? configTool : undefined;
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

	/** WebUI 管理页列表：DB 条目在前（可编辑），config 条目在后（只读）。 */
	registerRoute(router, { method: "get", path: "/search_tools/list" }, async () => {
		const searchTools: Record<string, unknown>[] = [];
		const seen = new Set<string>();
		if (db) {
			const rows = await db.select().from(LiteLLM_SearchToolsTable);
			for (const row of rows) {
				if (seen.has(row.search_tool_name)) {
					continue;
				}
				seen.add(row.search_tool_name);
				searchTools.push(databaseToolEntry(row));
			}
		}
		for (const tool of getConfig().routerSettings.search_tools ?? []) {
			if (!isRecord(tool)) {
				continue;
			}
			const entry = configToolEntry(tool);
			if (!entry || seen.has(String(entry["search_tool_name"]))) {
				continue;
			}
			seen.add(String(entry["search_tool_name"]));
			searchTools.push(entry);
		}
		return { search_tools: searchTools };
	});

	registerRoute(router, { method: "get", path: "/search_tools/ui/available_providers" }, () => ({
		providers: AVAILABLE_SEARCH_PROVIDERS,
	}));

	registerRoute(router, { method: "post", path: "/search_tools" }, async (req) => {
		const payload = readSearchToolPayload(req.body);
		if (!db) {
			throw ApiError.unavailable("搜索工具存储不可用");
		}
		const existing = await db
			.select({ id: LiteLLM_SearchToolsTable.search_tool_id })
			.from(LiteLLM_SearchToolsTable)
			.where(eq(LiteLLM_SearchToolsTable.search_tool_name, payload.search_tool_name));
		if (existing.length > 0) {
			throw ApiError.badRequest(`搜索工具 "${payload.search_tool_name}" 已存在`);
		}
		// config 中的同名工具占用运行时名称，DB 再建同名会让列表出现两个同名条目
		const configNames = new Set(
			(getConfig().routerSettings.search_tools ?? [])
				.filter(isRecord)
				.map((tool) => tool["search_tool_name"])
				.filter((name): name is string => typeof name === "string"),
		);
		if (configNames.has(payload.search_tool_name)) {
			throw ApiError.badRequest(`搜索工具 "${payload.search_tool_name}" 已在配置文件（YAML）中定义`);
		}
		const [row] = await db
			.insert(LiteLLM_SearchToolsTable)
			.values({
				search_tool_id: randomUUID(),
				search_tool_name: payload.search_tool_name,
				litellm_params: payload.litellm_params,
				...(payload.search_tool_info ? { search_tool_info: payload.search_tool_info } : {}),
			})
			.returning();
		return databaseToolEntry(row!);
	});

	registerRoute(router, { method: "put", path: "/search_tools/:id" }, async (req) => {
		const payload = readSearchToolPayload(req.body);
		if (!db) {
			throw ApiError.unavailable("搜索工具存储不可用");
		}
		const id = pathParam(req, "id");
		const [current] = await db.select().from(LiteLLM_SearchToolsTable).where(eq(LiteLLM_SearchToolsTable.search_tool_id, id));
		if (!current) {
			throw ApiError.notFound(`搜索工具 ${id} 不存在`);
		}
		if (current.search_tool_name !== payload.search_tool_name) {
			const clash = await db
				.select({ id: LiteLLM_SearchToolsTable.search_tool_id })
				.from(LiteLLM_SearchToolsTable)
				.where(eq(LiteLLM_SearchToolsTable.search_tool_name, payload.search_tool_name));
			if (clash.length > 0) {
				throw ApiError.badRequest(`搜索工具 "${payload.search_tool_name}" 已存在`);
			}
		}
		const [row] = await db
			.update(LiteLLM_SearchToolsTable)
			.set({
				search_tool_name: payload.search_tool_name,
				litellm_params: payload.litellm_params,
				search_tool_info: payload.search_tool_info ?? null,
			})
			.where(eq(LiteLLM_SearchToolsTable.search_tool_id, id))
			.returning();
		return databaseToolEntry(row!);
	});

	registerRoute(router, { method: "delete", path: "/search_tools/:id" }, async (req) => {
		if (!db) {
			throw ApiError.unavailable("搜索工具存储不可用");
		}
		const id = pathParam(req, "id");
		const [row] = await db.delete(LiteLLM_SearchToolsTable).where(eq(LiteLLM_SearchToolsTable.search_tool_id, id)).returning();
		if (!row) {
			throw ApiError.notFound(`搜索工具 ${id} 不存在`);
		}
		return { message: "Search tool deleted successfully", search_tool_id: row.search_tool_id };
	});

	registerRoute(router, { method: "post", path: "/search_tools/test_connection" }, async (req) => {
		const body = isRecord(req.body) ? req.body : {};
		const params = isRecord(body["litellm_params"]) ? body["litellm_params"] : {};
		return testGooglePseConnection(params);
	});

	registerRoute(router, { method: "post", path: "/v1/search/tools" }, notImpl("SearchTools 创建"));
	registerRoute(router, { method: "put", path: "/v1/search/tools/:id" }, notImpl("SearchTools 更新"));
	registerRoute(router, { method: "delete", path: "/v1/search/tools/:id" }, notImpl("SearchTools 删除"));

	/** 用某个搜索工具执行一次查询（详情页 Test Search Tool）。 */
	registerRoute(router, { method: "post", path: "/v1/search/:tool_name" }, async (req) => {
		const name = pathParam(req, "tool_name");
		const body = isRecord(req.body) ? req.body : {};
		const query = nonEmptyString(body["query"]);
		if (!query) {
			throw ApiError.badRequest("query 不能为空");
		}
		const rawMax = body["max_results"];
		const maxResults = typeof rawMax === "number" && Number.isFinite(rawMax) ? Math.trunc(rawMax) : 5;
		const tool = await findSearchTool(db, name);
		if (!tool) {
			throw ApiError.notFound(`搜索工具 ${name} 不存在`);
		}
		const params = isRecord(tool["litellm_params"]) ? tool["litellm_params"] : {};
		const provider = nonEmptyString(params["search_provider"]);
		if (provider !== "google_pse") {
			throw ApiError.badRequest(`不支持的搜索供应商: ${provider ?? "未指定"}`);
		}
		const results = await queryGooglePse(params, query, maxResults);
		return { object: "search", query: query, results: results };
	});
}

function notImpl(name: string) {
	return () => {
		throw new ApiError(503, `${name} 暂未实现`);
	};
}
