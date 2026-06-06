/**
 * Config Overrides 端点 — 桩实现
 *
 * WebUI AdminPanel → Hashicorp Vault 标签直接访问 `/config_overrides/hashicorp_vault`。
 * 返回与 Python LiteLLM 兼容的形状（空对象），避免 404 控制台错误。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerConfigOverridesRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/config_overrides/hashicorp_vault" }, () => ({}));
	registerRoute(router, { method: "post", path: "/config_overrides/hashicorp_vault" }, () => ({}));
	registerRoute(router, { method: "delete", path: "/config_overrides/hashicorp_vault" }, () => ({}));
	registerRoute(router, { method: "post", path: "/config_overrides/hashicorp_vault/test_connection" }, () => ({}));
}
