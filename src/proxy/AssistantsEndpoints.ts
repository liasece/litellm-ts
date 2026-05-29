/**
 * Assistants 端点 — 桩实现
 *
 * 对应 LiteLLM 的 /v1/assistants 等端点。当前返回 503。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerAssistantsRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/v1/assistants" }, notImpl("Assistants 列表"));
	registerRoute(router, { method: "post", path: "/v1/assistants" }, notImpl("Assistants 创建"));
	registerRoute(router, { method: "delete", path: "/v1/assistants/:id" }, notImpl("Assistants 删除"));
	registerRoute(router, { method: "post", path: "/v1/threads" }, notImpl("Threads 创建"));
	registerRoute(router, { method: "get", path: "/v1/threads/:id" }, notImpl("Threads 查询"));
	registerRoute(router, { method: "post", path: "/v1/threads/:id/messages" }, notImpl("Threads 消息"));
	registerRoute(router, { method: "get", path: "/v1/threads/:id/messages" }, notImpl("Threads 消息列表"));
	registerRoute(router, { method: "post", path: "/v1/threads/:id/runs" }, notImpl("Threads 运行"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
