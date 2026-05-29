/**
 * Rerank 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerRerankRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/rerank" }, notImpl("Rerank"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
