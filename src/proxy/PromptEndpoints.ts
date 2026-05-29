/**
 * Prompt 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerPromptRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/prompts" }, notImpl("Prompts 列表"));
	registerRoute(router, { method: "post", path: "/prompts" }, notImpl("Prompts 创建"));
	registerRoute(router, { method: "get", path: "/prompts/:id" }, notImpl("Prompts 查询"));
	registerRoute(router, { method: "put", path: "/prompts/:id" }, notImpl("Prompts 更新"));
	registerRoute(router, { method: "delete", path: "/prompts/:id" }, notImpl("Prompts 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
