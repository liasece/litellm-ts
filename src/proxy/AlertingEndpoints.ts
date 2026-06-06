/**
 * Alerting 端点 — 桩实现
 *
 * 返回与 Python LiteLLM 兼容的形状（数组，每项为配置字段描述），
 * 避免 WebUI 报 500 异常或控制台堆栈。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerAlertingRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/alerting/settings" }, () => []);
}
