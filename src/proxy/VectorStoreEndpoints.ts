/**
 * VectorStore 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerVectorStoreRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/v1/vector_stores" }, notImpl("VectorStore 创建"));
	registerRoute(router, { method: "get", path: "/v1/vector_stores" }, notImpl("VectorStore 列表"));
	registerRoute(router, { method: "post", path: "/v1/vector_stores/:id" }, notImpl("VectorStore 更新"));
	registerRoute(router, { method: "delete", path: "/v1/vector_stores/:id" }, notImpl("VectorStore 删除"));
	registerRoute(router, { method: "post", path: "/v1/vector_stores/:id/files" }, notImpl("VectorStore 文件"));
	registerRoute(router, { method: "get", path: "/v1/vector_stores/:id/files" }, notImpl("VectorStore 文件列表"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
