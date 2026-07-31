import type { Router, Request, Response } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import type { CliProxyOAuthProvider, CliProxyRuntimeStatus, CliProxyStoredSettings } from "./CliProxyTypes";

const OAUTH_PROVIDERS = new Set<CliProxyOAuthProvider>(["codex-device", "codex", "claude", "antigravity", "kimi", "xai"]);
const MAX_MANAGEMENT_BODY_BYTES = 64 * 1024 * 1024;
const MANAGEMENT_RESPONSE_BLOCKED_HEADERS = new Set(["connection", "transfer-encoding", "content-length", "keep-alive"]);

interface ManagementRoute {
	readonly methods: ReadonlySet<string>;
	readonly pattern: RegExp;
	readonly persistsConfig?: boolean;
}

function managementRoute(methods: readonly string[], pattern: RegExp, persistsConfig = false): ManagementRoute {
	return { methods: new Set(methods), pattern: pattern, persistsConfig: persistsConfig };
}

/**
 * CLIProxyAPI v7.2.110 management surface. Config/config.yaml and api-keys are
 * intentionally absent: LiteLLM owns the generated config and the child
 * process ingress key must never cross the loopback trust boundary.
 */
const MANAGEMENT_ROUTES: readonly ManagementRoute[] = [
	managementRoute(["GET"], /^\/latest-version$/),
	managementRoute(["GET"], /^\/plugins$/),
	managementRoute(["GET"], /^\/plugin-store$/),
	managementRoute(["POST"], /^\/plugin-store\/[^/]+\/install$/),
	managementRoute(["DELETE"], /^\/plugins\/[^/]+$/),
	managementRoute(["PATCH"], /^\/plugins\/[^/]+\/enabled$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/plugins\/[^/]+\/config$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/debug$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/logging-to-file$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/logs-max-total-size-mb$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/error-logs-max-files$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/usage-statistics-enabled$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/proxy-url$/, true),
	managementRoute(["POST"], /^\/api-call$/),
	managementRoute(["GET", "PUT", "PATCH"], /^\/quota-exceeded\/switch-project$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/quota-exceeded\/switch-preview-model$/, true),
	managementRoute(["POST"], /^\/reset-quota$/),
	managementRoute(["GET"], /^\/api-key-usage$/),
	managementRoute(["GET"], /^\/usage-queue$/),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/gemini-api-key$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/interactions-api-key$/, true),
	managementRoute(["GET", "DELETE"], /^\/logs$/),
	managementRoute(["GET"], /^\/request-error-logs$/),
	managementRoute(["GET"], /^\/request-error-logs\/[^/]+$/),
	managementRoute(["GET"], /^\/request-log-by-id\/[^/]+$/),
	managementRoute(["GET", "PUT", "PATCH"], /^\/request-log$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/ws-auth$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/request-retry$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/max-retry-interval$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/force-model-prefix$/, true),
	managementRoute(["GET", "PUT", "PATCH"], /^\/routing\/strategy$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/claude-api-key$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/codex-api-key$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/xai-api-key$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/openai-compatibility$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/vertex-api-key$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/oauth-excluded-models$/, true),
	managementRoute(["GET", "PUT", "PATCH", "DELETE"], /^\/oauth-model-alias$/, true),
	managementRoute(["GET", "POST", "DELETE"], /^\/auth-files$/),
	managementRoute(["GET"], /^\/auth-files\/models$/),
	managementRoute(["GET"], /^\/model-definitions\/[^/]+$/),
	managementRoute(["GET"], /^\/auth-files\/download$/),
	managementRoute(["PATCH"], /^\/auth-files\/status$/),
	managementRoute(["PATCH"], /^\/auth-files\/fields$/),
	managementRoute(["POST"], /^\/vertex\/import$/),
	managementRoute(["GET"], /^\/anthropic-auth-url$/),
	managementRoute(["GET"], /^\/codex-auth-url$/),
	managementRoute(["GET"], /^\/antigravity-auth-url$/),
	managementRoute(["GET"], /^\/kimi-auth-url$/),
	managementRoute(["GET"], /^\/xai-auth-url$/),
	managementRoute(["GET"], /^\/get-auth-status$/),
	managementRoute(["DELETE"], /^\/oauth-session$/),
];

function bodyRecord(req: Request): Record<string, unknown> {
	if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
		throw ApiError.badRequest("请求体必须是 JSON 对象");
	}
	return req.body as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeParam(req: Request, name: string): string {
	const value = req.params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw ApiError.badRequest(`路由参数 ${name} 缺失`);
	}
	return value;
}

function requireProxyAdmin(req: Request): void {
	if (req.auth?.user_role !== PROXY_ADMIN_ROLE) {
		throw ApiError.forbidden("CLIProxy management endpoint requires proxy_admin access");
	}
}

function managementResource(req: Request): string {
	const wildcard = req.params[0];
	const path = `/${Array.isArray(wildcard) ? (wildcard[0] ?? "") : (wildcard ?? "")}`;
	if (path.includes("..") || path.includes("\0")) {
		throw ApiError.badRequest("CLIProxy 管理资源路径无效");
	}
	return path;
}

function findManagementRoute(method: string, resource: string): ManagementRoute {
	const route = MANAGEMENT_ROUTES.find((candidate) => candidate.methods.has(method) && candidate.pattern.test(resource));
	if (!route) {
		throw new ApiError(404, "CLIProxy 管理接口不存在或由 LiteLLM 接管", "not_found");
	}
	return route;
}

async function readManagementBody(req: Request): Promise<Buffer | undefined> {
	if (req.method === "GET" || req.method === "HEAD") {
		return undefined;
	}
	const contentType = req.headers["content-type"];
	if (typeof contentType === "string" && contentType.includes("application/json")) {
		return req.body === undefined ? undefined : Buffer.from(JSON.stringify(req.body));
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
		size += value.length;
		if (size > MAX_MANAGEMENT_BODY_BYTES) {
			throw new ApiError(413, "CLIProxy 管理请求体超过 64 MB", "request_too_large");
		}
		chunks.push(value);
	}
	return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function proxyManagementRequest(req: Request, res: Response, runtime: CliProxyRuntimeManager): Promise<void> {
	requireProxyAdmin(req);
	const resource = managementResource(req);
	const route = findManagementRoute(req.method, resource);
	const queryIndex = req.originalUrl.indexOf("?");
	const resourceWithQuery = queryIndex >= 0 ? `${resource}${req.originalUrl.slice(queryIndex)}` : resource;
	const body = await readManagementBody(req);
	const headers = new Headers();
	const contentType = req.headers["content-type"];
	const accept = req.headers["accept"];
	if (typeof contentType === "string") {
		headers.set("Content-Type", contentType);
	}
	if (typeof accept === "string") {
		headers.set("Accept", accept);
	}
	const upstream = await runtime.managementRequest(resourceWithQuery, {
		method: req.method,
		headers: headers,
		body: body,
	});
	const responseBody = Buffer.from(await upstream.arrayBuffer());
	if (upstream.ok && route.persistsConfig && req.method !== "GET") {
		try {
			await runtime.persistManagementConfig();
		} catch (error) {
			// 变更已在上游生效，持久化失败不应把成功操作反转为客户端 500。
			// 注意：不能把中文错误写入响应头——Node setHeader 会对非 ASCII 值抛 ERR_INVALID_CHAR，
			// 反而破坏成功响应；仅记录到系统日志。
			const message = error instanceof Error ? error.message : String(error);
			runtime.appendSystemLog(`CLIProxy 配置持久化失败（变更已生效）: ${message}`);
		}
	}
	res.status(upstream.status);
	upstream.headers.forEach((value, key) => {
		if (!MANAGEMENT_RESPONSE_BLOCKED_HEADERS.has(key.toLowerCase())) {
			res.setHeader(key, value);
		}
	});
	res.end(responseBody);
}

/**
 * Register the admin-only CLIProxy control-plane API.
 * @param router
 * @param runtime
 */
export function registerCliProxyManagementRoutes(router: Router, runtime: CliProxyRuntimeManager): void {
	registerRoute(router, { method: "get", path: "/cliproxy/status" }, () => runtime.status());

	registerRoute(router, { method: "get", path: "/cliproxy/config" }, () => ({
		settings: runtime.settings,
		user_config: runtime.userConfig,
		status: runtime.status(),
	}));

	registerRoute(router, { method: "put", path: "/cliproxy/config" }, async (req) => {
		const body = bodyRecord(req);
		const enabled = body["enabled"] !== false;
		let status: CliProxyRuntimeStatus;
		if (typeof body["config_yaml"] === "string") {
			const settings: CliProxyStoredSettings = {
				enabled: enabled,
				config_yaml: body["config_yaml"],
			};
			status = await runtime.saveSettings(settings);
		} else if (isRecord(body["user_config"])) {
			status = await runtime.saveUserConfig(enabled, body["user_config"]);
		} else {
			throw ApiError.badRequest("必须提供 config_yaml 或 user_config");
		}
		return {
			settings: runtime.settings,
			user_config: runtime.userConfig,
			status: status,
		};
	});

	registerRoute(router, { method: "post", path: "/cliproxy/start" }, () => runtime.start());
	registerRoute(router, { method: "post", path: "/cliproxy/stop" }, () => runtime.stop());
	registerRoute(router, { method: "post", path: "/cliproxy/restart" }, () => runtime.restart());

	registerRoute(router, { method: "get", path: "/cliproxy/models" }, async () => ({
		data: (await runtime.listModels()).map((id) => ({ id: id })),
	}));

	registerRoute(router, { method: "get", path: "/cliproxy/logs" }, (req) => {
		const value = Array.isArray(req.query.after) ? req.query.after[0] : req.query.after;
		const after = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
		return runtime.logs(after);
	});

	registerRoute(router, { method: "get", path: "/cliproxy/accounts" }, async () => ({
		data: await runtime.listAccounts(),
	}));

	registerRoute(router, { method: "get", path: "/cliproxy/accounts/:authIndex/quota" }, (req) =>
		runtime.getAccountQuota(routeParam(req, "authIndex")),
	);

	registerRoute(router, { method: "patch", path: "/cliproxy/accounts/:filename" }, async (req) => {
		const body = bodyRecord(req);
		const disabled = typeof body["disabled"] === "boolean" ? body["disabled"] : undefined;
		const weight = body["weight"] === null || typeof body["weight"] === "number" ? body["weight"] : undefined;
		if (disabled === undefined && weight === undefined) {
			throw ApiError.badRequest("必须提供 disabled 或 weight");
		}
		await runtime.updateAccount(routeParam(req, "filename"), { disabled: disabled, weight: weight });
		return { status: "ok" };
	});

	registerRoute(router, { method: "delete", path: "/cliproxy/accounts/:filename" }, async (req) => {
		await runtime.trashAccount(routeParam(req, "filename"));
		return { status: "trashed" };
	});

	registerRoute(router, { method: "post", path: "/cliproxy/oauth" }, async (req) => {
		const provider = bodyRecord(req)["provider"];
		if (typeof provider !== "string" || !OAUTH_PROVIDERS.has(provider as CliProxyOAuthProvider)) {
			throw ApiError.badRequest("不支持的 OAuth Provider");
		}
		return runtime.startOAuth(provider as CliProxyOAuthProvider);
	});

	registerRoute(router, { method: "get", path: "/cliproxy/oauth/:id" }, (req) => runtime.getOAuthSession(routeParam(req, "id")));
	registerRoute(router, { method: "post", path: "/cliproxy/oauth/:id/input" }, (req) => {
		const input = bodyRecord(req)["input"];
		if (typeof input !== "string" || input.length > 4_096) {
			throw ApiError.badRequest("OAuth 输入无效");
		}
		return runtime.sendOAuthInput(routeParam(req, "id"), input);
	});

	registerRoute(router, { method: "get", path: "/cliproxy/update/check" }, () => runtime.checkLatestVersion());
	registerRoute(router, { method: "post", path: "/cliproxy/update" }, (req) => {
		const version = bodyRecord(req)["version"];
		if (version !== undefined && typeof version !== "string") {
			throw ApiError.badRequest("version 必须是字符串");
		}
		return runtime.installAndActivate(version as string | undefined);
	});
	registerRoute(router, { method: "post", path: "/cliproxy/rollback" }, (req) => {
		const version = bodyRecord(req)["version"];
		if (typeof version !== "string") {
			throw ApiError.badRequest("version 必须是字符串");
		}
		return runtime.rollback(version);
	});

	for (const method of ["get", "post", "put", "patch", "delete"] as const) {
		registerRoute(router, { method: method, path: "/cliproxy/management/*" }, (req, res) => proxyManagementRequest(req, res, runtime));
	}
}
