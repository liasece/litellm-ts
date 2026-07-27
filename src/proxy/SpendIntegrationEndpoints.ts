/**
 * SpendIntegration 端点 — 桩实现
 *
 * 提供与 Python LiteLLM 兼容的桩响应，避免 WebUI 出现 404/500 控制台错误。
 * 真实数据接入时只需替换返回体即可。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerSpendIntegrationRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/spend-integration/vantage" }, () => ({
		api_key: null,
		connection_id: null,
	}));
	registerRoute(router, { method: "post", path: "/spend-integration/vantage" }, () => ({ status: "ok" }));
	// CloudZero 桩响应与 Python LiteLLM 保持一致：所有字段返回 null
	registerRoute(router, { method: "get", path: "/spend-integration/cloudzero" }, () => ({
		api_key_masked: null,
		connection_id: null,
		timezone: null,
		status: null,
	}));
	registerRoute(router, { method: "post", path: "/spend-integration/cloudzero" }, () => ({ status: "ok" }));
	// WebUI cloudzero_export_modal.tsx 直接请求以下三个端点，缺少即 404
	registerRoute(router, { method: "get", path: "/cloudzero/settings" }, () => ({
		api_key_masked: null,
		connection_id: null,
		timezone: null,
		status: null,
	}));
	registerRoute(router, { method: "post", path: "/cloudzero/init" }, () => ({
		message: "CloudZero settings saved",
		status: "configured",
	}));
	registerRoute(router, { method: "put", path: "/cloudzero/settings" }, () => ({
		message: "CloudZero settings updated",
		status: "configured",
	}));
	registerRoute(router, { method: "post", path: "/cloudzero/export" }, () => ({
		message: "CloudZero export scheduled",
		export_id: "stub",
	}));
}
