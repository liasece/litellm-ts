/**
 * Email Events 端点 — 桩实现
 *
 * WebUI Settings → Email Alerts 标签直接访问 `/email/event_settings`。
 * 返回与 Python LiteLLM 兼容的形状，避免 404 控制台错误。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerEmailEventsRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/email/event_settings" }, () => ({ settings: [] }));
	registerRoute(router, { method: "patch", path: "/email/event_settings" }, () => ({ settings: [] }));
	registerRoute(router, { method: "post", path: "/email/event_settings/reset" }, () => ({ settings: [] }));
}
