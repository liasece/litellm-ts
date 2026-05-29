/**
 * Anthropic Skills 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerAnthropicSkillsRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/anthropic/skills" }, notImpl("Skills 创建"));
	registerRoute(router, { method: "get", path: "/anthropic/skills" }, notImpl("Skills 列表"));
	registerRoute(router, { method: "get", path: "/anthropic/skills/:id" }, notImpl("Skills 查询"));
	registerRoute(router, { method: "delete", path: "/anthropic/skills/:id" }, notImpl("Skills 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
