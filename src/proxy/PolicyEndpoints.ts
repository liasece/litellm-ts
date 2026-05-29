/**
 * Policy 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerPolicyRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/policy/new" }, notImpl("Policy 创建"));
	registerRoute(router, { method: "post", path: "/policy/update" }, notImpl("Policy 更新"));
	registerRoute(router, { method: "get", path: "/policy/list" }, notImpl("Policy 列表"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
