import { modelString, type ModelCredential } from "../support/ModelModels";
export function createCredentialPayload(values: Record<string, unknown>): Record<string, unknown> {
	const filtered = Object.fromEntries(
		Object.entries(values).filter(([, value]) => value !== "" && value !== undefined && value !== null),
	);
	return {
		credential_name: filtered.credential_name,
		credential_values: Object.fromEntries(
			Object.entries(filtered).filter(([key]) => !["credential_name", "custom_llm_provider"].includes(key)),
		),
		credential_info: { custom_llm_provider: filtered.custom_llm_provider },
	};
}
export function updateCredentialPayload(
	values: Record<string, unknown>,
	touched: ReadonlySet<string>,
	existing: ModelCredential,
	deleted: readonly string[],
): Record<string, unknown> {
	const credentialValues: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		if (
			["credential_name", "custom_llm_provider", "delete_secret_fields"].includes(key) ||
			!touched.has(key) ||
			value === "" ||
			value == null
		)
			continue;
		if (typeof value === "string" && value.startsWith("****")) continue;
		credentialValues[key] = value;
	}
	for (const key of deleted) credentialValues[key] = null;
	const provider = modelString(values.custom_llm_provider);
	return {
		credential_values: credentialValues,
		...(touched.has("custom_llm_provider") && provider && provider !== existing.credential_info.custom_llm_provider
			? { credential_info: { custom_llm_provider: provider } }
			: {}),
	};
}
