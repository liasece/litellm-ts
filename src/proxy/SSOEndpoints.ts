/**
 * SSO 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerSSORoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/sso/callback" }, notImpl("SSO Callback"));
	registerRoute(router, { method: "get", path: "/sso/key/generate" }, notImpl("SSO Key Generate"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
