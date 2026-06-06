/**
 * MCP 管理端点 — 桩实现 + access_groups 支撑
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * 注册 MCP 路由
 * @param router - Express Router 实例
 */
export function registerMCPRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/mcp/servers" }, notImpl("MCP Servers list"));
	registerRoute(router, { method: "post", path: "/mcp/servers" }, notImpl("MCP Servers create"));
	registerRoute(router, { method: "delete", path: "/mcp/servers/:id" }, notImpl("MCP Servers delete"));
	registerRoute(router, { method: "get", path: "/mcp/tools" }, notImpl("MCP Tools"));
	registerRoute(router, { method: "get", path: "/mcp/connections" }, notImpl("MCP Connections"));

	// ── MCP Access Groups ──

	/** 获取所有 MCP 访问组，WebUI 用于 MCP 权限管理表单（直接数组） */
	registerRoute(router, { method: "get", path: "/v1/mcp/access_groups" }, () => []);

	/** 获取 MCP 客户端 IP */
	registerRoute(router, { method: "get", path: "/v1/mcp/network/client-ip" }, () => ({
		ip: null,
	}));

	// ── MCP Servers 页面依赖的子端点 ──

	/** MCP Servers 列表中每条记录的健康状态 — WebUI MCP Servers 页用 */
	registerRoute(router, { method: "get", path: "/v1/mcp/server/health" }, () => []);

	/** MCP 语义过滤器设置（WebUI MCP Servers 页面 "Semantic Filter" 标签） */
	registerRoute(router, { method: "get", path: "/get/mcp_semantic_filter_settings" }, () => ({}));

	/**
	 * 用户提交的 MCP Servers（WebUI MCP Servers 页面 "Submitted MCPs" 标签，
	 * 期望 {items, total, pending_review, active, rejected}）。
	 *
	 * pending_review 是 WebUI 协议字段名（snake_case），与已有 `mcp_access_groups` / `server_name`
	 * 等 snake_case 字段保持一致；用文件级 `eslint-disable camelcase` 标注此模块对外协议字段
	 * 都是 snake_case，避免逐字段增加 lint allow list 噪音。
	 */
	registerRoute(router, { method: "get", path: "/v1/mcp/server/submissions" }, () => ({
		items: [],
		total: 0,
		pending_review: 0,
		active: 0,
		rejected: 0,
	}));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} not implemented`), { statusCode: 503 });
	};
}
