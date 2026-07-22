/**
 * Config Overrides 端点 — 桩实现
 *
 * WebUI AdminPanel → Hashicorp Vault 标签直接访问 `/config_overrides/hashicorp_vault`。
 * 返回与 Python LiteLLM 兼容的形状（空对象），避免 404 控制台错误。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";

/** Hashicorp Vault config fields mirrored from Python LiteLLM. */
const HASHICORP_VAULT_FIELDS: ReadonlyArray<{ readonly fieldName: string; readonly fieldType: string; readonly description: string }> = [
	{ fieldName: "vault_addr", fieldType: "string", description: "Hashicorp Vault address" },
	{ fieldName: "vault_token", fieldType: "string", description: "Hashicorp Vault token" },
	{ fieldName: "approle_role_id", fieldType: "string", description: "AppRole role id" },
	{ fieldName: "approle_secret_id", fieldType: "string", description: "AppRole secret id" },
	{ fieldName: "approle_mount_path", fieldType: "string", description: "AppRole mount path" },
	{ fieldName: "client_cert", fieldType: "string", description: "TLS client certificate" },
	{ fieldName: "client_key", fieldType: "string", description: "TLS client private key" },
	{ fieldName: "vault_cert_role", fieldType: "string", description: "Vault certificate auth role" },
	{ fieldName: "vault_namespace", fieldType: "string", description: "Vault namespace" },
	{ fieldName: "vault_mount_name", fieldType: "string", description: "Vault KV mount name" },
	{ fieldName: "vault_path_prefix", fieldType: "string", description: "Vault secret path prefix" },
];

function makeHashicorpVaultSettingsResponse(): Record<string, unknown> {
	const properties: Record<string, { description: string; type: string }> = {};
	const values: Record<string, null> = {};
	for (const field of HASHICORP_VAULT_FIELDS) {
		properties[field.fieldName] = { description: field.description, type: field.fieldType };
		values[field.fieldName] = null;
	}
	return {
		config_type: "hashicorp_vault",
		values: values,
		field_schema: {
			description: "Hashicorp Vault secret manager configuration",
			properties: properties,
		},
	};
}

/**
 * @param router
 */
export function registerConfigOverridesRoutes(router: Router): void {
	registerRoute(router, { method: "get", path: "/config_overrides/hashicorp_vault" }, makeHashicorpVaultSettingsResponse);
	registerRoute(router, { method: "post", path: "/config_overrides/hashicorp_vault" }, () => ({
		status: "success",
		message: "Hashicorp Vault configuration update skipped: persistence is disabled in litellm-ts compatibility mode",
	}));
	registerRoute(router, { method: "delete", path: "/config_overrides/hashicorp_vault" }, () => ({
		status: "success",
		message: "Hashicorp Vault configuration deleted successfully",
	}));
	registerRoute(router, { method: "post", path: "/config_overrides/hashicorp_vault/test_connection" }, () => ({
		status: "error",
		message: "Hashicorp Vault is not configured. Save a configuration first.",
	}));
}
