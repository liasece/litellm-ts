/**
 * Compliance 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerComplianceRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/compliance/check" }, notImpl("Compliance 检查"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
