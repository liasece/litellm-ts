/**
 * Util 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerUtilRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/utils/token_counter" }, notImpl("Token Counter"));
	registerRoute(router, { method: "get", path: "/utils/supported_openai_params" }, notImpl("Supported Params"));
	registerRoute(router, { method: "post", path: "/utils/transform_request" }, notImpl("Transform Request"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
