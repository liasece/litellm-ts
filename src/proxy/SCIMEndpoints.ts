/**
 * SCIM 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerSCIMRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/scim/v2/Users" }, notImpl("SCIM Users"));
	registerRoute(router, { method: "post", path: "/scim/v2/Users" }, notImpl("SCIM Users 创建"));
	registerRoute(router, { method: "get", path: "/scim/v2/Groups" }, notImpl("SCIM Groups"));
	registerRoute(router, { method: "post", path: "/scim/v2/Groups" }, notImpl("SCIM Groups 创建"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
