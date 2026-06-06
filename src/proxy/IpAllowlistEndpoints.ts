/**
 * IP Allowlist 端点 — 桩实现
 *
 * WebUI AdminPanel 调用 `/get/allowed_ips`、`/add/allowed_ip`、`/delete/allowed_ip`。
 * 真实实现需要从数据库/配置加载 IP 列表；当前返回空数组，避免 404 控制台错误。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerIpAllowlistRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/get/allowed_ips" }, () => []);
	registerRoute(router, { method: "post", path: "/add/allowed_ip" }, () => ({ status: "ok" }));
	registerRoute(router, { method: "post", path: "/delete/allowed_ip" }, () => ({ status: "ok" }));
}
