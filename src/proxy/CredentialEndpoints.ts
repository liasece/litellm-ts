/** Credential 管理端点：HTTP 层负责输入校验，动态数据以数据库为准。 */
import type { Request, Router } from "express";
import { ApiError } from "../core/api/ApiError";
import { registerRoute } from "../core/api/registerRoute";
import type { CredentialService, CredentialPatch } from "../credentials/CredentialService";
import { CredentialServiceError } from "../credentials/CredentialService";
import { CredentialRepositoryConflictError } from "../repositories/CredentialRepository";
import type { Deployment } from "../types/router";
import { PROXY_ADMIN_USER_ID } from "../types/webUiSession";

interface CredentialCreateBody {
	readonly credential_name?: unknown;
	readonly credential_values?: unknown;
	readonly credential_info?: unknown;
	readonly model_id?: unknown;
	readonly attach_to_model?: unknown;
}

interface CredentialModelRouter {
	getDeployment(modelId: string): Deployment | null;
}

/**
 * 注册持久化 Credential API。
 * @param router
 * @param credentialService
 * @param modelRouter
 */
export function registerCredentialRoutes(router: Router, credentialService: CredentialService, modelRouter: CredentialModelRouter): void {
	registerRoute(router, { method: "get", path: "/credentials" }, async () => ({
		credentials: await callService(() => credentialService.list()),
	}));

	registerRoute(router, { method: "get", path: "/credentials/by_name/:name" }, async (req) => {
		const name = req.params.name as string;
		const credential = await callService(() => credentialService.getByName(name));
		if (credential === null) {
			throw ApiError.notFound(`Credential not found: ${name}`);
		}
		return credential;
	});

	registerRoute(router, { method: "get", path: "/credentials/by_model/:modelId" }, async (req) => {
		const modelId = req.params.modelId as string;
		return callService(() => credentialService.getByModel(modelId, modelRouter.getDeployment(modelId)));
	});

	registerRoute(router, { method: "post", path: "/credentials" }, async (req) => {
		const body = (req.body ?? {}) as CredentialCreateBody;
		const credentialName = requiredString(body.credential_name, "credential_name");
		const actorId = getActorId(req);
		if (body.attach_to_model === true) {
			const modelId = requiredString(body.model_id, "model_id");
			await callService(() =>
				credentialService.createFromModel(
					{
						credential_name: credentialName,
						model_id: modelId,
						credential_info: optionalRecord(body.credential_info, "credential_info"),
					},
					actorId,
				),
			);
		} else {
			await callService(() =>
				credentialService.create(
					{
						credential_name: credentialName,
						credential_values: optionalRecord(body.credential_values, "credential_values") ?? {},
						credential_info: optionalRecord(body.credential_info, "credential_info"),
					},
					actorId,
				),
			);
		}
		return { success: true, credential_name: credentialName };
	});

	registerRoute(router, { method: "patch", path: "/credentials/:credentialName" }, async (req) => {
		const credentialName = req.params.credentialName as string;
		const body = asRecord(req.body, "request body") as CredentialPatch;
		const updated = await callService(() => credentialService.patch(credentialName, body, getActorId(req)));
		if (!updated) {
			throw ApiError.notFound(`Credential not found: ${credentialName}`);
		}
		return { success: true };
	});

	registerRoute(router, { method: "delete", path: "/credentials/:credentialName" }, async (req) => {
		const credentialName = req.params.credentialName as string;
		const deleted = await callService(() => credentialService.delete(credentialName));
		if (!deleted) {
			throw ApiError.notFound(`Credential not found: ${credentialName}`);
		}
		return { success: true };
	});
}

async function callService<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof CredentialServiceError) {
			throw new ApiError(error.statusCode, error.message);
		}
		if (
			error instanceof CredentialRepositoryConflictError ||
			(typeof error === "object" && error !== null && "code" in error && error.code === "CREDENTIAL_NAME_CONFLICT")
		) {
			throw ApiError.conflict("Credential name already exists");
		}
		throw error;
	}
}

function requiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw ApiError.badRequest(`${fieldName} is required`);
	}
	return value;
}

function optionalRecord(value: unknown, fieldName: string): Record<string, unknown> | undefined {
	return value === undefined ? undefined : asRecord(value, fieldName);
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw ApiError.badRequest(`${fieldName} must be an object`);
	}
	return value as Record<string, unknown>;
}

function getActorId(req: Request): string {
	return req.auth?.user_id ?? PROXY_ADMIN_USER_ID;
}
