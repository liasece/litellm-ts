/**
 * Claude Code Marketplace 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerClaudeCodeMarketplaceRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/claude-code/marketplace" }, notImpl("Marketplace 列表"));
	registerRoute(router, { method: "post", path: "/claude-code/marketplace" }, notImpl("Marketplace 创建"));
	registerRoute(router, { method: "get", path: "/claude-code/marketplace/:id" }, notImpl("Marketplace 查询"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
