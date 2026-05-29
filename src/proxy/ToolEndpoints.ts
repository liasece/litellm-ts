/**
 * Tool 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerToolRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/tool/new" }, notImpl("Tool 创建"));
	registerRoute(router, { method: "post", path: "/tool/delete" }, notImpl("Tool 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
