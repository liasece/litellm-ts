/**
 * OCR / Video / Container 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerOCRVideoContainerRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/ocr" }, notImpl("OCR"));
	registerRoute(router, { method: "post", path: "/v1/video" }, notImpl("Video"));
	registerRoute(router, { method: "post", path: "/v1/video/retrieve" }, notImpl("Video Retrieve"));
	registerRoute(router, { method: "post", path: "/v1/containers" }, notImpl("Containers"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
