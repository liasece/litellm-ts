/**
 * Credential 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerCredentialRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/credentials" }, notImpl("Credentials 创建"));
	registerRoute(router, { method: "get", path: "/v1/credentials" }, notImpl("Credentials 列表"));
	registerRoute(router, { method: "get", path: "/v1/credentials/:name" }, notImpl("Credentials 查询"));
	registerRoute(router, { method: "delete", path: "/v1/credentials/:name" }, notImpl("Credentials 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
