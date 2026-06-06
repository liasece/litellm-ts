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
	// WebUI AdminPanel 调用 getSSOSettings/updateSSOSettings。
	// 真实实现需要写入数据库；当前返回空 values 即可。
	registerRoute(router, { method: "get", path: "/get/sso_settings" }, () => ({ values: {}, sso_settings: {} }));
	registerRoute(router, { method: "patch", path: "/update/sso_settings" }, () => ({ status: "ok" }));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} not implemented`), { statusCode: 503 });
	};
}
