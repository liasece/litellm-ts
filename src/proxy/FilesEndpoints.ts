/**
 * Files 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerFilesRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/files" }, notImpl("Files 上传"));
	registerRoute(router, { method: "get", path: "/v1/files" }, notImpl("Files 列表"));
	registerRoute(router, { method: "get", path: "/v1/files/:id" }, notImpl("Files 查询"));
	registerRoute(router, { method: "get", path: "/v1/files/:id/content" }, notImpl("Files 内容"));
	registerRoute(router, { method: "delete", path: "/v1/files/:id" }, notImpl("Files 删除"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
