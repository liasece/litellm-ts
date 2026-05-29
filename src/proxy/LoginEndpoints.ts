/**
 * Login 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerLoginRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/login" }, notImpl("Login"));
	registerRoute(router, { method: "post", path: "/v2/login" }, notImpl("Login v2"));
	registerRoute(router, { method: "post", path: "/v3/login" }, notImpl("Login v3"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
