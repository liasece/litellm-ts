/**
 * Credential 端点 — WebUI 凭据管理支撑
 *
 * WebUI Models 页面通过 /credentials（GET/POST/DELETE）管理 provider 凭据。
 * 对齐 WebUI CredentialsResponse / CredentialItem 接口。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";

/** 内存中的凭据存储（进程重启后清空，无需持久化） */
const credentialStore = new Map<string, CredentialItem>();

/** 凭据条目（对齐 WebUI CredentialItem 接口） */
interface CredentialItem {
	credential_name: string;
	credential_values: Record<string, unknown>;
	credential_info: {
		custom_llm_provider?: string;
		description?: string;
		required?: boolean;
	};
}

/**
 * 注册凭据管理端点
 * @param router - Express Router 实例
 */
export function registerCredentialRoutes(router: Router): void {
	/** 获取所有凭据 */
	registerRoute(router, { method: "get", path: "/credentials" }, () => ({
		credentials: Array.from(credentialStore.values()),
	}));

	/** 创建凭据 */
	registerRoute(router, { method: "post", path: "/credentials" }, (req) => {
		const body = req.body ?? {};
		const credentialName = body.credential_name as string | undefined;
		if (!credentialName) {
			throw ApiError.badRequest("credential_name is required");
		}
		const item: CredentialItem = {
			credential_name: credentialName,
			credential_values: body.credential_values ?? {},
			credential_info: body.credential_info ?? {},
		};
		credentialStore.set(credentialName, item);
		return { success: true };
	});

	/** 按名称查询凭据 */
	registerRoute(router, { method: "get", path: "/credentials/by_name/:name" }, (req) => {
		const name = req.params.name as string;
		const item = credentialStore.get(name);
		if (!item) {
			throw ApiError.notFound(`Credential not found: ${name}`);
		}
		return item;
	});

	/** 按模型查询凭据 */
	registerRoute(router, { method: "get", path: "/credentials/by_model/:modelId" }, () => {
		// 暂不实现按模型查找逻辑
		return { credentials: [] };
	});

	/** 删除凭据 */
	registerRoute(router, { method: "delete", path: "/credentials/:credentialName" }, (req) => {
		const name = req.params.credentialName as string;
		if (!credentialStore.delete(name)) {
			throw ApiError.notFound(`Credential not found: ${name}`);
		}
		return { success: true };
	});
}
