/**
 * MCP 管理端点 — 桩实现 + access_groups 支撑
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

const EMPTY_MCP_SERVER_LIST: unknown[] = [];

const EMPTY_MCP_ACCESS_GROUPS_RESPONSE = { access_groups: [] as unknown[] };

const EMPTY_MCP_SUBMISSIONS_RESPONSE = {
	items: [] as unknown[],
	total: 0,
	pending_review: 0,
	active: 0,
	rejected: 0,
};

const MCP_USER_CREDENTIAL_STATUS_EMPTY = {
	has_user_credential: false,
	credential_name: null,
	created_at: null,
	updated_at: null,
};

/**
 * Mask token-like values before echoing MCP credential payloads.
 * @param payload - Credential payload that may contain fields safe to echo only after masking.
 */
function maskCredentialPayload(payload: Record<string, unknown>): Record<string, unknown> {
	const masked: Record<string, unknown> = {};
	const secretFields = new Set([
		"auth_value",
		"client_id",
		"client_secret",
		"aws_access_key_id",
		"aws_secret_access_key",
		"aws_session_token",
		"token",
	]);
	for (const [fieldName, fieldValue] of Object.entries(payload)) {
		masked[fieldName] =
			secretFields.has(fieldName) && typeof fieldValue === "string" && fieldValue.length > 0 ? "********" : fieldValue;
	}
	return masked;
}

/**
 * 注册 MCP 路由。
 * @param router - Express Router 实例。
 */
export function registerMCPRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/mcp/servers" }, () => EMPTY_MCP_SERVER_LIST);
	registerRoute(router, { method: "post", path: "/mcp/servers" }, notImpl("MCP Servers create"));
	registerRoute(router, { method: "delete", path: "/mcp/servers/:id" }, notImpl("MCP Servers delete"));
	registerRoute(router, { method: "get", path: "/mcp/tools" }, () => []);
	registerRoute(router, { method: "get", path: "/mcp/connections" }, () => []);
	registerRoute(router, { method: "get", path: "/v1/mcp/server/health" }, () => []);
	registerRoute(router, { method: "post", path: "/v1/mcp/server/test/connection" }, () => ({
		status: "error",
		error: true,
		message: "MCP server connections are not configured",
	}));
	registerRoute(router, { method: "post", path: "/v1/mcp/server/test/tools/list" }, () => ({
		tools: [],
		error: null,
		message: "Found 0 tools from MCP server",
	}));
	registerRoute(router, { method: "post", path: "/v1/mcp/server" }, (req) => ({
		...req.body,
		credentials: maskCredentialPayload((req.body?.credentials as Record<string, unknown> | undefined) ?? {}),
	}));
	registerRoute(router, { method: "put", path: "/v1/mcp/server" }, (req) => ({
		...req.body,
		credentials: maskCredentialPayload((req.body?.credentials as Record<string, unknown> | undefined) ?? {}),
	}));
	registerRoute(router, { method: "delete", path: "/v1/mcp/server/:id" }, () => ({ deleted: true }));
	registerRoute(router, { method: "post", path: "/v1/mcp/server/register" }, (req) => ({
		...req.body,
		approval_status: "pending_review",
	}));
	registerRoute(
		router,
		{ method: "get", path: "/v1/mcp/server/:id/oauth-user-credential/status" },
		() => MCP_USER_CREDENTIAL_STATUS_EMPTY,
	);
	registerRoute(router, { method: "get", path: "/v1/mcp/server/:id/oauth-user-credential" }, () => MCP_USER_CREDENTIAL_STATUS_EMPTY);
	registerRoute(router, { method: "post", path: "/v1/mcp/server/:id/oauth-user-credential" }, (req) => ({
		...MCP_USER_CREDENTIAL_STATUS_EMPTY,
		has_user_credential: true,
		credential: maskCredentialPayload(req.body ?? {}),
	}));
	registerRoute(router, { method: "delete", path: "/v1/mcp/server/:id/oauth-user-credential" }, () => ({ deleted: true }));

	// ── MCP Access Groups ──

	/** 获取所有 MCP 访问组，WebUI 用于 MCP 权限管理表单（直接数组） */
	registerRoute(router, { method: "get", path: "/v1/mcp/access_groups" }, () => EMPTY_MCP_ACCESS_GROUPS_RESPONSE);

	/** 获取 MCP 客户端 IP */
	registerRoute(router, { method: "get", path: "/v1/mcp/network/client-ip" }, () => ({
		ip: null,
	}));

	// ── MCP Servers 页面依赖的子端点 ──

	/** MCP Servers 列表中每条记录的健康状态 — WebUI MCP Servers 页用 */
	registerRoute(router, { method: "get", path: "/v1/mcp/server/health" }, () => []);

	/** MCP 语义过滤器设置（WebUI MCP Servers 页面 "Semantic Filter" 标签） */
	registerRoute(router, { method: "get", path: "/get/mcp_semantic_filter_settings" }, () => ({}));

	/**
	 * 用户提交的 MCP Servers（WebUI MCP Servers 页面 "Submitted MCPs" 标签，
	 * 期望 {items, total, pending_review, active, rejected}）。
	 *
	 * pending_review 是 WebUI 协议字段名（snake_case），与已有 `mcp_access_groups` / `server_name`
	 * 等 snake_case 字段保持一致；用文件级 `eslint-disable camelcase` 标注此模块对外协议字段
	 * 都是 snake_case，避免逐字段增加 lint allow list 噪音。
	 */
	registerRoute(router, { method: "get", path: "/v1/mcp/server/submissions" }, () => EMPTY_MCP_SUBMISSIONS_RESPONSE);
}

function notImpl(name: string) {
	return () => {
		throw Object.assign(new Error(`${name} not implemented`), { statusCode: 503 });
	};
}
