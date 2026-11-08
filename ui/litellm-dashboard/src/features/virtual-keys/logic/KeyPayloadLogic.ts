import type { KeyDraft, VirtualKey } from "../support/VirtualKeyModels";

function enumerableMetadata(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value));
	if (typeof value === "string") return Object.fromEntries(Array.from(value).map((letter, index) => [String(index), letter]));
	return {};
}
function metadataFromDraft(draft: KeyDraft, editing: boolean): unknown {
	let metadata: unknown;
	try {
		metadata = JSON.parse(draft.metadataText || "{}");
	} catch (error: unknown) {
		if (editing) throw error;
		metadata = {};
	}
	if (editing) {
		const normalized = enumerableMetadata(metadata);
		delete normalized.tags;
		if (draft.tags.length) normalized.tags = [...draft.tags];
		metadata = normalized;
	}
	if (draft.logging.length)
		metadata = { ...enumerableMetadata(metadata), logging: draft.logging.filter((config) => config.callback_name) };
	if (draft.disabled_callbacks.length)
		metadata = { ...enumerableMetadata(metadata), litellm_disabled_callbacks: [...draft.disabled_callbacks] };
	return metadata;
}
function objectPermissions(draft: KeyDraft, key?: VirtualKey): Record<string, unknown> {
	const fields: Record<string, unknown> = { ...key?.object_permission };
	for (const [name, values] of [
		["vector_stores", draft.vector_stores],
		["mcp_servers", draft.mcp_servers],
		["mcp_access_groups", draft.mcp_access_groups],
		["agents", draft.allowed_agents],
		["agent_access_groups", draft.agent_access_groups],
	] as const)
		if (key || values.length) fields[name] = [...values];
	if (key || Object.keys(draft.mcp_tool_permissions).length) fields.mcp_tool_permissions = { ...draft.mcp_tool_permissions };
	return fields;
}
export function buildKeyPayload(
	draft: KeyDraft,
	options: { userId: string; key?: VirtualKey; canEditGuardrails: boolean; customKeysDisabled?: boolean },
): Record<string, unknown> {
	const editing = Boolean(options.key);
	const present = (name: string) => editing || draft.presentFields.includes(name);
	const metadata = metadataFromDraft(draft, editing);
	const payload: Record<string, unknown> = {
		...draft.advanced,
		blocked: draft.blocked,
		team_id: draft.team_id || null,
		key_alias: draft.key_alias,
		models: !editing && ["management", "read_only"].includes(draft.key_type) ? [] : [...draft.models],
		key_type: draft.key_type,
		metadata,
		duration: draft.never_expire ? null : draft.duration || null,
	};
	for (const name of ["max_budget", "tpm_limit", "rpm_limit", "max_parallel_requests"] as const) {
		if (present(name) || draft[name] !== null) payload[name] = draft[name];
	}
	if (present("budget_duration") || draft.budget_duration)
		payload.budget_duration =
			({ daily: "24h", weekly: "7d", monthly: "30d" } as Record<string, string>)[draft.budget_duration] ||
			draft.budget_duration ||
			null;
	for (const name of ["tpm_limit_type", "rpm_limit_type"] as const) if (present(name) || draft[name]) payload[name] = draft[name] || null;
	const optionalArrays = ["policies", "prompts", "tags", "access_group_ids", "allowed_passthrough_routes"] as const;
	for (const name of optionalArrays) {
		const initial = editing ? (name === "prompts" || name === "tags" ? options.key?.metadata[name] : options.key?.[name]) : undefined;
		if (
			draft.presentFields.includes(name) ||
			initial !== undefined ||
			(!editing && draft[name].length) ||
			(editing && name === "access_group_ids")
		)
			payload[name] = [...draft[name]];
	}
	if (present("disable_global_guardrails") || draft.disable_global_guardrails)
		payload.disable_global_guardrails = draft.disable_global_guardrails;
	if (
		options.canEditGuardrails &&
		(draft.presentFields.includes("guardrails") ||
			options.key?.metadata.guardrails !== undefined ||
			(!editing && draft.guardrails.length))
	)
		payload.guardrails = [...draft.guardrails];
	if (!options.canEditGuardrails) {
		delete payload.guardrails;
		delete payload.prompts;
	}
	if (draft.auto_rotate || present("auto_rotate")) payload.auto_rotate = draft.auto_rotate;
	if (draft.auto_rotate || (editing && draft.rotation_interval)) payload.rotation_interval = draft.rotation_interval;
	if (options.key) {
		payload.key = options.key.token || options.key.token_id;
		payload.token = payload.key;
		delete payload.key_type;
		if (draft.omitTeamOnUpdate) delete payload.team_id;
		payload.organization_id = draft.organization_id || null;
		payload.allowed_routes = draft.allowed_routes
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		payload.object_permission = objectPermissions(draft, options.key);
		payload.disabled_callbacks = [...draft.disabled_callbacks];
		if (options.canEditGuardrails && draft.guardrails.length && metadata && typeof metadata === "object")
			Object.assign(metadata, { guardrails: [...draft.guardrails] });
		if (draft.model_tpm_limit.trim() || draft.presentFields.includes("model_tpm_limit"))
			payload.model_tpm_limit = draft.model_tpm_limit ? JSON.parse(draft.model_tpm_limit) : "";
		if (draft.model_rpm_limit.trim() || draft.presentFields.includes("model_rpm_limit"))
			payload.model_rpm_limit = draft.model_rpm_limit ? JSON.parse(draft.model_rpm_limit) : "";
		if (!draft.never_expire) payload.duration = draft.duration;
		delete payload.tags;
	} else {
		if (draft.organization_id) payload.organization_id = draft.organization_id;
		if (draft.project_id) payload.project_id = draft.project_id;
		if (draft.owner === "you") payload.user_id = options.userId;
		else if (draft.owner === "another_user") payload.user_id = draft.user_id;
		else if (draft.owner === "service_account") {
			if (!metadata || typeof metadata !== "object") throw new Error("Cannot add service account ID to metadata");
			Object.assign(metadata, { service_account_id: draft.key_alias });
		} else if (draft.owner === "agent") {
			payload.agent_id = draft.agent_id;
			payload.user_id = options.userId;
		}
		if (!options.customKeysDisabled && draft.key.trim()) payload.key = draft.key.trim();
		else if (options.customKeysDisabled) delete payload.key;
		const permission = objectPermissions(draft);
		if (Object.keys(permission).length) payload.object_permission = permission;
		if (Object.keys(draft.router_settings).length) payload.router_settings = { ...draft.router_settings };
		if (Object.keys(draft.aliases).length) payload.aliases = { ...draft.aliases };
	}
	for (const name of ["config", "enforced_params", "aliases"])
		if (typeof payload[name] === "string" && payload[name]) payload[name] = JSON.parse(payload[name]);
	return payload;
}
