/**
 * MCP 管理端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerMCPRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/mcp/servers" }, notImpl("MCP Servers 列表"));
	registerRoute(router, { method: "post", path: "/mcp/servers" }, notImpl("MCP Servers 创建"));
	registerRoute(router, { method: "delete", path: "/mcp/servers/:id" }, notImpl("MCP Servers 删除"));
	registerRoute(router, { method: "get", path: "/mcp/tools" }, notImpl("MCP Tools"));
	registerRoute(router, { method: "get", path: "/mcp/connections" }, notImpl("MCP Connections"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
