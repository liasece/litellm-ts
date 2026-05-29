/**
 * Realtime 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerRealtimeRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/realtime/transcriptions" }, notImpl("Realtime 转录"));
	registerRoute(router, { method: "post", path: "/v1/realtime/sessions" }, notImpl("Realtime 会话"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
