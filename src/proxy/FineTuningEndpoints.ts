/**
 * FineTuning 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerFineTuningRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/fine_tuning/jobs" }, notImpl("FineTuning 创建"));
	registerRoute(router, { method: "get", path: "/v1/fine_tuning/jobs" }, notImpl("FineTuning 列表"));
	registerRoute(router, { method: "get", path: "/v1/fine_tuning/jobs/:id" }, notImpl("FineTuning 查询"));
	registerRoute(router, { method: "post", path: "/v1/fine_tuning/jobs/:id/cancel" }, notImpl("FineTuning 取消"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
