/**
 * Analytics 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerAnalyticsRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/global/activity/cache_hits" }, notImpl("Cache Hits"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
