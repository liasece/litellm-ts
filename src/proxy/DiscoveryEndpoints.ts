/**
 * Discovery 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerDiscoveryRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/.well-known/litellm-ui-config" }, notImpl("UI Config"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
