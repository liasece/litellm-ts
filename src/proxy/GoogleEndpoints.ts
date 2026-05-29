/**
 * Google / Vertex AI 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerGoogleRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/vertex-ai/models/:id:predict" }, notImpl("Vertex AI"));
	registerRoute(router, { method: "post", path: "/google-ai-studio/models/:id:predict" }, notImpl("Google AI Studio"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
