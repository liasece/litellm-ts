import type { KeyDraft, KeyTeam, VirtualKey } from "../support/VirtualKeyModels";
import { recordValue, stringValues } from "../support/VirtualKeyModels";

export function keyTypeFromRoutes(routes: unknown): string {
	const values = stringValues(routes);
	return values.includes("llm_api_routes")
		? "llm_api"
		: values.includes("management_routes")
			? "management"
			: values.includes("info_routes")
				? "read_only"
				: "default";
}
export function createKeyDraft(key?: VirtualKey): KeyDraft {
	const metadata = key?.metadata ?? {};
	const permission = recordValue(key?.object_permission);
	const aliases = recordValue(key?.aliases);
	const tpm = metadata.model_tpm_limit ?? key?.model_tpm_limit;
	const rpm = metadata.model_rpm_limit ?? key?.model_rpm_limit;
	return {
		omitTeamOnUpdate: false,
		presentFields: ["blocked", "team_id", "key_alias", "models", "key_type", "metadata", "duration"],
		owner: "you",
		user_id: key?.user_id ?? "",
		agent_id: "",
		organization_id: key?.organization_id ?? key?.org_id ?? "",
		team_id: key?.team_id ?? "",
		key_alias: key?.key_alias ?? "",
		key: "",
		blocked: key?.blocked === true,
		models: [...(key?.models ?? [])],
		key_type: key ? keyTypeFromRoutes(key.allowed_routes) : "llm_api",
		allowed_routes: stringValues(key?.allowed_routes).join(", "),
		max_budget: key?.max_budget ?? null,
		budget_duration: key ? (["24h", "7d", "30d"].includes(key.budget_duration || "") ? key.budget_duration || "" : "") : "",
		tpm_limit: key?.tpm_limit ?? null,
		tpm_limit_type: String(key?.tpm_limit_type ?? ""),
		rpm_limit: key?.rpm_limit ?? null,
		rpm_limit_type: String(key?.rpm_limit_type ?? ""),
		max_parallel_requests: key?.max_parallel_requests ?? null,
		model_tpm_limit: tpm ? JSON.stringify(tpm) : "",
		model_rpm_limit: rpm ? JSON.stringify(rpm) : "",
		vector_stores: stringValues(permission.vector_stores),
		allowed_agents: stringValues(permission.agents),
		agent_access_groups: stringValues(permission.agent_access_groups),
		metadataText: key ? JSON.stringify(Object.fromEntries(Object.entries(metadata).filter(([name]) => name !== "tags")), null, 2) : "",
		logging: Array.isArray(metadata.logging)
			? metadata.logging.map(recordValue).map((value) => ({ ...value, callback_name: String(value.callback_name ?? "") }))
			: [],
		disabled_callbacks: stringValues(metadata.litellm_disabled_callbacks),
		router_settings: { ...recordValue(key?.router_settings) },
		aliases: Object.fromEntries(Object.entries(aliases).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
		duration: "",
		never_expire: !key?.expires,
		auto_rotate: key?.auto_rotate ?? false,
		rotation_interval: key ? key.rotation_interval || "" : "30d",
	};
}
export function validateKeyDraft(
	draft: KeyDraft,
	options: { creating: boolean; team?: KeyTeam; customKeysDisabled?: boolean; rows?: readonly VirtualKey[] },
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (options.creating && !draft.key_alias.trim()) errors.key_alias = "Please input a key name";
	if (draft.owner === "another_user" && !draft.user_id)
		errors.user_id = "Please input the user ID of the user you are assigning the key to";
	if (options.creating && !options.customKeysDisabled && draft.key.trim()) {
		if (!draft.key.trim().startsWith("sk-")) errors.key = "Custom Key must start with 'sk-'";
		else if (draft.key.trim().length < 16) errors.key = "Custom Key must be at least 16 characters long";
	}
	if (options.creating && options.rows?.some((key) => key.key_alias === draft.key_alias && (key.team_id ?? "") === draft.team_id))
		errors.key_alias =
			"Key alias " +
			draft.key_alias +
			" already exists for team with ID " +
			(draft.team_id || "null") +
			", please provide another key alias";
	for (const [field, label] of [
		["max_budget", "Budget"],
		["tpm_limit", "TPM limit"],
		["rpm_limit", "RPM limit"],
	] as const) {
		const value = draft[field];
		const maximum = options.team?.[field];
		if (options.creating && value !== null && maximum != null && value > maximum)
			errors[field] =
				label +
				" cannot exceed team " +
				(field === "max_budget" ? "max budget: " : field === "tpm_limit" ? "TPM limit: " : "RPM limit: ") +
				maximum;
	}
	for (const field of ["metadataText", "model_tpm_limit", "model_rpm_limit"] as const) {
		if (field === "metadataText" && options.creating) continue;
		try {
			if (draft[field].trim()) JSON.parse(draft[field]);
		} catch {
			errors[field] = field === "metadataText" ? "Invalid metadata JSON" : "Must be a valid JSON object";
		}
	}
	return errors;
}
export function applyKeyPrefill(
	draft: KeyDraft,
	query: URLSearchParams,
	teams: readonly KeyTeam[],
	role: string,
	allowedModels: readonly string[],
): void {
	const owner = query.get("owned_by");
	if (owner === "you" || (owner === "another_user" && role === "Admin")) draft.owner = owner;
	const team = teams.find((team) => team.team_id === query.get("team_id"));
	if (team) draft.team_id = team.team_id;
	draft.key_alias = (query.get("key_alias") ?? "").trim().slice(0, 256);
	const type = query.get("key_type");
	if (["default", "llm_api", "management"].includes(type ?? "")) draft.key_type = type!;
	const models = (query.get("models") ?? "")
		.split(",")
		.slice(0, 100)
		.map((model) => model.trim().slice(0, 256))
		.filter(Boolean);
	draft.models = models.filter((model) => model === "all-team-models" || allowedModels.includes(model));
	if (draft.models.includes("all-team-models")) draft.models = ["all-team-models"];
}
