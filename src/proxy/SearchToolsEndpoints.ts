/**
 * SearchTools 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerSearchToolsRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/v1/search/tools" }, notImpl("SearchTools 列表"));
	registerRoute(router, { method: "post", path: "/v1/search/tools" }, notImpl("SearchTools 创建"));
	registerRoute(router, { method: "put", path: "/v1/search/tools/:id" }, notImpl("SearchTools 更新"));
	registerRoute(router, { method: "delete", path: "/v1/search/tools/:id" }, notImpl("SearchTools 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
