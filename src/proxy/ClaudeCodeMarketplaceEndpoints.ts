/**
 * Claude Code Marketplace 端点
 *
 * GET /claude-code/plugins：列出已注册的 Claude Code 插件（管理面），
 * 对齐 Python litellm/proxy/anthropic_endpoints/claude_code_endpoints/claude_code_marketplace.py
 * list_plugins：DB 查询 LiteLLM_ClaudeCodePluginTable，manifest_json 解析补充
 * source/author/homepage/keywords/category，created_at 倒序，响应 {plugins, count}。
 */
import type { Router } from "express";
import { desc } from "drizzle-orm";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { liteLLM_ClaudeCodePluginTable } from "../db/schema/claude-code-plugins";
import type { DrizzleDb } from "../core/db/Database";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析 manifest_json（容忍非法 JSON），对齐 PY json.loads 容错路径
 * @param manifestJson
 */
function parseManifest(manifestJson: string | null): Record<string, unknown> {
	if (!manifestJson) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(manifestJson);
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * @param router
 * @param db - Drizzle DB 实例（读取 LiteLLM_ClaudeCodePluginTable）
 */
export function registerClaudeCodeMarketplaceRoutes(router: Router, db?: DrizzleDb): void {
	registerRoute(router, { method: "get", path: "/claude-code/plugins" }, async (req) => {
		if (!db) {
			return { plugins: [], count: 0 };
		}
		// PY: enabled_only=true 时仅返回 enabled 插件
		const enabledOnly = req.query["enabled_only"] === "true";
		const rows = await db.select().from(liteLLM_ClaudeCodePluginTable).orderBy(desc(liteLLM_ClaudeCodePluginTable.createdAt));
		const plugins = rows
			.filter((row) => !enabledOnly || row.enabled === true)
			.map((row) => {
				const manifest = parseManifest(row.manifestJson);
				return {
					id: row.id,
					name: row.name,
					version: row.version,
					description: row.description,
					source: isRecord(manifest["source"]) ? manifest["source"] : {},
					author: manifest["author"] ?? null,
					homepage: manifest["homepage"] ?? null,
					keywords: manifest["keywords"] ?? null,
					category: manifest["category"] ?? null,
					enabled: row.enabled,
					created_at: row.createdAt?.toISOString() ?? null,
					updated_at: row.updatedAt?.toISOString() ?? null,
				};
			});
		return { plugins: plugins, count: plugins.length };
	});

	registerRoute(router, { method: "get", path: "/claude-code/marketplace" }, notImpl("Marketplace 列表"));
	registerRoute(router, { method: "post", path: "/claude-code/plugins" }, notImpl("Plugin 注册"));
	registerRoute(router, { method: "post", path: "/claude-code/marketplace" }, notImpl("Marketplace 创建"));
	registerRoute(router, { method: "get", path: "/claude-code/marketplace/:id" }, notImpl("Marketplace 查询"));
}

function notImpl(name: string) {
	return () => {
		throw new ApiError(503, `${name} 暂未实现`);
	};
}
