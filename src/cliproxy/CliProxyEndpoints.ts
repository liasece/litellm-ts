import { Router, type Request } from "express";
import { ApiError } from "../core/api/ApiError";
import { registerRoute } from "../core/api/registerRoute";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import { SUBSCRIPTION_PROVIDERS, isSubscriptionProvider } from "../subscriptions/SubscriptionProviders";
import type { SubscriptionRuntimeManager } from "../subscriptions/native/SubscriptionRuntimeManager";
import type { CliProxyOAuthProvider } from "./CliProxyTypes";

const OAUTH_PROVIDERS = new Set<CliProxyOAuthProvider>(["codex-device", "codex", "claude", "antigravity", "kimi", "xai"]);

/**
 * 读取 JSON 对象请求体。
 * @param req - 请求
 * @throws {ApiError} 请求体不是 JSON 对象时抛出
 */
function bodyRecord(req: Request): Record<string, unknown> {
	if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
		throw ApiError.badRequest("请求体必须是 JSON 对象");
	}
	return req.body as Record<string, unknown>;
}

/**
 * 读取路由参数。
 * @param req - 请求
 * @param name - 参数名
 * @throws {ApiError} 参数缺失时抛出
 */
function routeParam(req: Request, name: string): string {
	const value = req.params[name];
	if (typeof value !== "string" || value.length === 0) {
		throw ApiError.badRequest(`路由参数 ${name} 缺失`);
	}
	return value;
}

/**
 * 要求 proxy_admin。
 * @param req - 请求
 * @throws {ApiError} 非 proxy_admin 时抛出
 */
function requireProxyAdmin(req: Request): void {
	if (req.auth?.user_role !== PROXY_ADMIN_ROLE) {
		throw ApiError.forbidden("订阅管理接口需要 proxy_admin 权限");
	}
}

/**
 * 注册订阅管理 API。
 *
 * 保留账号、额度、目录、日志与 OAuth；CPA 配置编辑、插件商店、启动/停止/重启、
 * 在线升级与高级管理代理均已下线并返回 410。
 * @param parent - 已鉴权的管理路由
 * @param runtime - 原生订阅运行时
 */
export function registerCliProxyManagementRoutes(parent: Router, runtime: SubscriptionRuntimeManager): void {
	const router = Router();
	parent.use(["/subscriptions", "/cliproxy"], router);
	registerRoute(router, { method: "get", path: "/status" }, () => runtime.status());

	registerRoute(router, { method: "get", path: "/config" }, () => ({
		settings: runtime.settings,
		user_config: runtime.userConfig,
		status: runtime.status(),
	}));

	registerRoute(router, { method: "put", path: "/config" }, async (req) => {
		const body = bodyRecord(req);
		if (body["config_yaml"] !== undefined || body["user_config"] !== undefined) {
			throw new ApiError(410, "订阅配置编辑已下线；账号仍可在账户页管理");
		}
		const status = await runtime.setEnabled(body["enabled"] !== false);
		return {
			settings: runtime.settings,
			user_config: runtime.userConfig,
			status: status,
		};
	});

	for (const path of ["/start", "/stop", "/restart", "/update", "/rollback"]) {
		registerRoute(router, { method: "post", path: path }, () => {
			throw new ApiError(410, "订阅运行时为进程内实现，无需启停或在线升级");
		});
	}
	registerRoute(router, { method: "get", path: "/update/check" }, () => ({
		current: "native",
		latest: "native",
		update_available: false,
		releases: [],
	}));

	registerRoute(router, { method: "get", path: "/models" }, async () => ({
		data: (await runtime.listModels()).map((id) => ({ id: id })),
	}));

	registerRoute(router, { method: "get", path: "/:provider/models" }, async (req) => {
		const provider = routeParam(req, "provider");
		if (!isSubscriptionProvider(provider)) {
			throw ApiError.notFound("未知订阅 Provider");
		}
		return { data: (await runtime.listSubscriptionModels(provider)).map((id) => ({ id: id })) };
	});

	registerRoute(router, { method: "get", path: "/logs" }, (req) => {
		const value = Array.isArray(req.query.after) ? req.query.after[0] : req.query.after;
		const after = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
		return runtime.logs(after);
	});

	const keyProvider = (req: Request): "commandcode" | "opencode-go" => {
		requireProxyAdmin(req);
		const provider = routeParam(req, "provider");
		if (provider !== "commandcode" && provider !== "opencode-go") {
			throw ApiError.badRequest("此订阅使用 OAuth 登录");
		}
		return provider;
	};
	registerRoute(router, { method: "get", path: "/:provider/keys" }, async (req) => ({
		data: await runtime.listSavedKeys(keyProvider(req)),
	}));
	registerRoute(router, { method: "post", path: "/:provider/keys" }, async (req) => {
		const provider = keyProvider(req);
		const body = bodyRecord(req);
		if (typeof body["label"] !== "string" || (body["api_key"] !== undefined && typeof body["api_key"] !== "string")) {
			throw ApiError.badRequest("请填写有效的订阅账号名称和密钥");
		}
		return {
			data: await runtime.saveSubscriptionKey(
				provider,
				undefined,
				body["label"],
				typeof body["api_key"] === "string" ? body["api_key"] : undefined,
			),
		};
	});
	registerRoute(router, { method: "patch", path: "/:provider/keys/:id" }, async (req) => {
		const provider = keyProvider(req);
		const body = bodyRecord(req);
		if (typeof body["label"] !== "string" || (body["api_key"] !== undefined && typeof body["api_key"] !== "string")) {
			throw ApiError.badRequest("请填写有效的订阅账号名称和密钥");
		}
		return {
			data: await runtime.saveSubscriptionKey(
				provider,
				routeParam(req, "id"),
				body["label"],
				typeof body["api_key"] === "string" ? body["api_key"] : undefined,
			),
		};
	});
	registerRoute(router, { method: "delete", path: "/:provider/keys/:id" }, async (req) => {
		await runtime.revokeSubscriptionKey(keyProvider(req), routeParam(req, "id"));
		return { status: "trashed" };
	});

	registerRoute(router, { method: "get", path: "/accounts/provider/:provider" }, async (req) => {
		const provider = routeParam(req, "provider");
		if (!isSubscriptionProvider(provider)) {
			throw ApiError.notFound("未知订阅 Provider");
		}
		const accounts = await runtime.listAccounts({ includeTrashed: req.query["include_trashed"] === "true" });
		return { data: accounts.filter((account) => account.provider === SUBSCRIPTION_PROVIDERS[provider].source) };
	});

	registerRoute(router, { method: "get", path: "/accounts" }, async (req) => ({
		data: await runtime.listAccounts({ includeTrashed: req.query["include_trashed"] === "true" }),
	}));

	registerRoute(router, { method: "get", path: "/accounts/:authIndex/quota" }, (req) =>
		runtime.getAccountQuota(routeParam(req, "authIndex")),
	);

	registerRoute(router, { method: "patch", path: "/accounts/:filename" }, async (req) => {
		const body = bodyRecord(req);
		const disabled = typeof body["disabled"] === "boolean" ? body["disabled"] : undefined;
		const weight = body["weight"] === null || typeof body["weight"] === "number" ? body["weight"] : undefined;
		if (disabled === undefined && weight === undefined) {
			throw ApiError.badRequest("必须提供 disabled 或 weight");
		}
		await runtime.updateAccount(routeParam(req, "filename"), { disabled: disabled, weight: weight });
		return { status: "ok" };
	});

	registerRoute(router, { method: "post", path: "/accounts/:filename/restore" }, async (req) => {
		await runtime.restoreAccount(routeParam(req, "filename"));
		return { status: "restored" };
	});

	registerRoute(router, { method: "delete", path: "/accounts/:filename" }, async (req) => {
		await runtime.trashAccount(routeParam(req, "filename"));
		return { status: "trashed" };
	});

	registerRoute(router, { method: "get", path: "/commandcode/accounts" }, async () => ({
		data: await runtime.listCommandCodeAccounts(),
	}));

	registerRoute(router, { method: "post", path: "/commandcode/accounts" }, async (req) => {
		const body = bodyRecord(req);
		return { data: await runtime.addCommandCodeAccount(body["api_key"], body["label"]) };
	});

	registerRoute(router, { method: "patch", path: "/commandcode/accounts/:index" }, async (req) => {
		const index = Number(routeParam(req, "index"));
		if (!Number.isInteger(index)) {
			throw ApiError.badRequest("CommandCode 账户索引无效");
		}
		const body = bodyRecord(req);
		const patch: { apiKey?: unknown; label?: unknown } = {};
		if (body["api_key"] !== undefined) {
			patch.apiKey = body["api_key"];
		}
		if (body["label"] !== undefined) {
			patch.label = body["label"];
		}
		if (patch.apiKey === undefined && patch.label === undefined) {
			throw ApiError.badRequest("必须提供 api_key 或 label");
		}
		return { data: await runtime.updateCommandCodeAccount(index, patch) };
	});

	registerRoute(router, { method: "delete", path: "/commandcode/accounts/:index" }, async (req) => {
		const index = Number(routeParam(req, "index"));
		if (!Number.isInteger(index)) {
			throw ApiError.badRequest("CommandCode 账户索引无效");
		}
		return { data: await runtime.deleteCommandCodeAccount(index) };
	});

	registerRoute(router, { method: "post", path: "/oauth" }, async (req) => {
		const provider = bodyRecord(req)["provider"];
		if (typeof provider !== "string" || !OAUTH_PROVIDERS.has(provider as CliProxyOAuthProvider)) {
			throw ApiError.badRequest("不支持的 OAuth Provider");
		}
		return runtime.startOAuth(provider as CliProxyOAuthProvider);
	});

	registerRoute(router, { method: "get", path: "/oauth/:id" }, (req) => runtime.getOAuthSession(routeParam(req, "id")));
	registerRoute(router, { method: "post", path: "/oauth/:id/input" }, async (req) => {
		const input = bodyRecord(req)["input"];
		if (typeof input !== "string" || input.length > 4_096) {
			throw ApiError.badRequest("OAuth 输入无效");
		}
		return runtime.sendOAuthInput(routeParam(req, "id"), input);
	});

	for (const method of ["get", "post", "put", "patch", "delete"] as const) {
		registerRoute(router, { method: method, path: "/management/*" }, () => {
			throw new ApiError(410, "高级管理面已下线");
		});
	}
}
