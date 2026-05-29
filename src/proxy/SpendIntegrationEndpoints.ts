/**
 * SpendIntegration 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerSpendIntegrationRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/spend-integration/vantage" }, notImpl("Vantage"));
	registerRoute(router, { method: "post", path: "/spend-integration/vantage" }, notImpl("Vantage 配置"));
	registerRoute(router, { method: "get", path: "/spend-integration/cloudzero" }, notImpl("CloudZero"));
	registerRoute(router, { method: "post", path: "/spend-integration/cloudzero" }, notImpl("CloudZero 配置"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
