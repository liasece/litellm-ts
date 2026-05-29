/**
 * Agent 端点 — 桩实现
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/**
 * @param router
 */
export function registerAgentRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/v1/agents" }, notImpl("Agents 列表"));
	registerRoute(router, { method: "post", path: "/v1/agents" }, notImpl("Agents 创建"));
	registerRoute(router, { method: "get", path: "/v1/agents/:id" }, notImpl("Agents 查询"));
	registerRoute(router, { method: "put", path: "/v1/agents/:id" }, notImpl("Agents 更新"));
	registerRoute(router, { method: "delete", path: "/v1/agents/:id" }, notImpl("Agents 删除"));
	registerRoute(router, { method: "post", path: "/v1/agent/chat/completions" }, notImpl("Agent Chat"));
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} 暂未实现`), { statusCode: 503 });
	};
}
