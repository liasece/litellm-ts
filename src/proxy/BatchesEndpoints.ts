/**
 * Batches 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerBatchesRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/batches" }, notImpl("Batches 创建"));
	registerRoute(router, { method: "get", path: "/v1/batches" }, notImpl("Batches 列表"));
	registerRoute(router, { method: "get", path: "/v1/batches/:id" }, notImpl("Batches 查询"));
	registerRoute(router, { method: "post", path: "/v1/batches/:id/cancel" }, notImpl("Batches 取消"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
