/**
 * Discovery 端点
 *
 * Python LiteLLM WebUI 在启动时会无鉴权读取 UI 配置。
 *
 * 注意：以下字段当前硬编码为 false/空，TS 端尚未实现对应功能：
 * - `sso_configured` / `auto_redirect_to_sso` — TS 端尚未实现 SSO 端点
 *   （Python litellm/proxy/proxy_server.py::get_ui_config）。
 * - `is_control_plane` — TS 端尚未实现 Control Plane 模式（多实例 / 集群）。
 * - `workers` — TS 端无 worker 列表概念。
 *   待端点实现后，从 general_settings 或环境变量读取；目前保持硬编码 false/[] 以
 *   让 WebUI 走普通 admin 视图（不会触发 SSO 跳转或控制面分支）。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

interface UiDiscoveryConfig {
	readonly server_root_path: string;
	readonly proxy_base_url: string | null;
	/**
	 * TODO: TS SSO 端点实现后，从 SSO 配置读取。
	 * 当前固定 false — 不应启用 SSO 自动跳转。
	 */
	readonly auto_redirect_to_sso: boolean;
	readonly admin_ui_disabled: boolean;
	/**
	 * TODO: TS SSO 端点实现后，从 SSO 配置读取。
	 * 当前固定 false — WebUI 会展示"未配置 SSO"。
	 */
	readonly sso_configured: boolean;
	/**
	 * TODO: TS Control Plane 实现后，从环境变量或 general_settings 读取。
	 * 当前固定 false — WebUI 走单实例 admin 视图。
	 */
	readonly is_control_plane: boolean;
	/**
	 * TODO: TS 多实例 / 集群 worker 列表实现后填充。
	 * 当前固定空数组。
	 */
	readonly workers: unknown[];
}

/**
 * 注册 WebUI discovery 路由。
 * 必须挂在鉴权中间件之前，对齐 Python `/litellm/.well-known/litellm-ui-config`。
 * @param router
 */
export function registerDiscoveryRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/.well-known/litellm-ui-config" }, getUiConfig);
	registerRoute(router, { method: "get", path: "/litellm/.well-known/litellm-ui-config" }, getUiConfig);
}

function getUiConfig(): UiDiscoveryConfig {
	return {
		server_root_path: "/",
		proxy_base_url: process.env.PROXY_BASE_URL ?? null,
		// TODO: SSO 端点实现后改为读取配置
		auto_redirect_to_sso: false,
		admin_ui_disabled: false,
		// TODO: SSO 端点实现后改为读取配置
		sso_configured: false,
		// TODO: Control Plane 实现后改为读取配置
		is_control_plane: false,
		// TODO: Worker 列表实现后填充
		workers: [],
	};
}
