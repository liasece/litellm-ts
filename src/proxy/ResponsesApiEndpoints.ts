/**
 * Responses API 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerResponsesApiRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/responses" }, notImpl("Responses 创建"));
	registerRoute(router, { method: "get", path: "/v1/responses/:id" }, notImpl("Responses 查询"));
	registerRoute(router, { method: "delete", path: "/v1/responses/:id" }, notImpl("Responses 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
