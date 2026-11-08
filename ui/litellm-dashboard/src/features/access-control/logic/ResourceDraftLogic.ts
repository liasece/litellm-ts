import type { AccessRecord, AccessTeam, AccessOrganization } from "../support/AccessModels";
export function objectValue(value: unknown): AccessRecord {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as AccessRecord) : {};
}
export function stringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
export function parseMetadata(value: unknown, label = "metadata"): AccessRecord {
	if (value == null || value === "") return {};
	if (typeof value !== "string") return objectValue(value);
	try {
		return objectValue(JSON.parse(value));
	} catch {
		throw new Error("Invalid JSON in " + label + " field");
	}
}
export function teamDraft(team?: AccessTeam): AccessRecord {
	if (!team) return { team_alias: "", models: [], organization_id: null };
	const { logging, secret_manager_settings, soft_budget_alerting_emails, ...metadata } = team.metadata ?? {},
		memberBudget = objectValue(team.team_member_budget_table);
	return {
		...team,
		metadata: team.metadata ? JSON.stringify(metadata, null, 2) : "",
		soft_budget_alerting_emails: Array.isArray(soft_budget_alerting_emails) ? soft_budget_alerting_emails.join(", ") : "",
		guardrails: stringList(team.metadata?.guardrails),
		policies: [...(team.policies ?? [])],
		disable_global_guardrails: team.metadata?.disable_global_guardrails ?? false,
		logging_settings: Array.isArray(logging) ? logging : [],
		secret_manager_settings: secret_manager_settings ? JSON.stringify(secret_manager_settings, null, 2) : "",
		team_member_budget: memberBudget.max_budget,
		team_member_budget_duration: memberBudget.budget_duration,
		team_member_key_duration: team.metadata?.team_member_key_duration,
		team_member_tpm_limit: memberBudget.tpm_limit,
		team_member_rpm_limit: memberBudget.rpm_limit,
		vector_stores: team.object_permission?.vector_stores ?? [],
		mcp_servers: team.object_permission?.mcp_servers ?? [],
		mcp_access_groups: team.object_permission?.mcp_access_groups ?? [],
		mcp_tool_permissions: team.object_permission?.mcp_tool_permissions ?? {},
		agents: team.object_permission?.agents ?? [],
		agent_access_groups: team.object_permission?.agent_access_groups ?? [],
		access_group_ids: team.access_group_ids ?? [],
		model_aliases: objectValue(team.litellm_model_table).model_aliases ?? {},
	};
}
export function organizationDraft(org?: AccessOrganization): AccessRecord {
	if (!org) return { organization_alias: "" };
	return {
		organization_alias: org.organization_alias,
		models: [...org.models],
		...org.litellm_budget_table,
		metadata: org.metadata ? JSON.stringify(org.metadata, null, 2) : "",
		vector_stores: org.object_permission?.vector_stores ?? [],
		mcp_servers: org.object_permission?.mcp_servers ?? [],
		mcp_access_groups: org.object_permission?.mcp_access_groups ?? [],
	};
}
export function resourcePermissions(draft: AccessRecord, existing: AccessRecord = {}): AccessRecord {
	const permission = { ...existing };
	for (const name of ["vector_stores", "mcp_servers", "mcp_access_groups", "agents", "agent_access_groups"] as const) {
		const values = stringList(draft[name]);
		if (values.length || name === "mcp_servers" || name === "mcp_access_groups") permission[name] = values;
	}
	const selected = new Set(stringList(draft.mcp_servers));
	permission.mcp_tool_permissions = Object.fromEntries(
		Object.entries(objectValue(draft.mcp_tool_permissions)).filter(([server]) => selected.has(server)),
	);
	return permission;
}
export function buildTeamCreatePayload(draft: AccessRecord): AccessRecord {
	const body = { ...draft };
	const permission = Object.fromEntries(
		Object.entries(resourcePermissions(draft)).filter(([, value]) =>
			Array.isArray(value) ? value.length > 0 : Object.keys(objectValue(value)).length > 0,
		),
	);
	for (const name of [
		"vector_stores",
		"mcp_servers",
		"mcp_access_groups",
		"mcp_tool_permissions",
		"agents",
		"agent_access_groups",
		"logging_settings",
		"model_aliases",
		"router_settings",
	])
		delete body[name];
	body.organization_id = typeof draft.organization_id === "string" && draft.organization_id.trim() ? draft.organization_id.trim() : null;
	if (draft.metadata) body.metadata = parseMetadata(draft.metadata);
	else delete body.metadata;
	if (Array.isArray(draft.logging_settings) && draft.logging_settings.length)
		body.metadata = {
			...objectValue(body.metadata),
			logging: draft.logging_settings.filter((value) => objectValue(value).callback_name),
		};
	if (draft.secret_manager_settings) {
		body.secret_manager_settings = parseMetadata(draft.secret_manager_settings, "secret manager settings");
	}
	if (Object.values(permission).some((value) => (Array.isArray(value) ? value.length : Object.keys(objectValue(value)).length)))
		body.object_permission = permission;
	if (Object.keys(objectValue(draft.model_aliases)).length) body.model_aliases = draft.model_aliases;
	if (Object.values(objectValue(draft.router_settings)).some((value) => value !== null && value !== undefined && value !== ""))
		body.router_settings = draft.router_settings;
	return body;
}
export function buildTeamUpdatePayload(id: string, draft: AccessRecord): AccessRecord {
	const metadata = parseMetadata(draft.metadata);
	delete metadata.soft_budget_alerting_emails;
	const numeric = (value: unknown) =>
		value == null || value === "" || (typeof value === "number" && Number.isNaN(value)) ? null : value;
	const body: AccessRecord = {
		team_id: id,
		team_alias: draft.team_alias,
		models: draft.models,
		tpm_limit: numeric(draft.tpm_limit),
		rpm_limit: numeric(draft.rpm_limit),
		max_budget: numeric(draft.max_budget),
		soft_budget: numeric(draft.soft_budget),
		budget_duration: draft.budget_duration,
		organization_id: draft.organization_id,
		metadata: {
			...metadata,
			...(stringList(draft.guardrails).length ? { guardrails: draft.guardrails } : {}),
			...(Array.isArray(draft.logging_settings) && draft.logging_settings.length ? { logging: draft.logging_settings } : {}),
			disable_global_guardrails: draft.disable_global_guardrails || false,
			soft_budget_alerting_emails:
				typeof draft.soft_budget_alerting_emails === "string"
					? draft.soft_budget_alerting_emails
							.split(",")
							.map((value) => value.trim())
							.filter(Boolean)
					: (draft.soft_budget_alerting_emails ?? []),
			...(typeof draft.secret_manager_settings === "string" && draft.secret_manager_settings.trim()
				? { secret_manager_settings: parseMetadata(draft.secret_manager_settings, "secret manager settings") }
				: {}),
		},
		...(stringList(draft.policies).length ? { policies: draft.policies } : {}),
		team_member_budget_duration: draft.team_member_budget_duration,
		object_permission: resourcePermissions(draft),
	};
	if (draft.team_member_budget !== undefined) body.team_member_budget = Number(draft.team_member_budget);
	if (draft.team_member_key_duration !== undefined) body.team_member_key_duration = draft.team_member_key_duration;
	if (draft.team_member_tpm_limit !== undefined || draft.team_member_rpm_limit !== undefined) {
		body.team_member_tpm_limit = numeric(draft.team_member_tpm_limit);
		body.team_member_rpm_limit = numeric(draft.team_member_rpm_limit);
	}
	if (draft.access_group_ids !== undefined) body.access_group_ids = draft.access_group_ids;
	return body;
}
export function buildOrganizationPayload(draft: AccessRecord, org?: AccessOrganization): AccessRecord {
	if (!org) {
		const body = { ...draft };
		for (const key of ["vector_stores", "mcp_servers", "mcp_access_groups"]) delete body[key];
		if (draft.metadata) body.metadata = parseMetadata(draft.metadata);
		if (["vector_stores", "mcp_servers", "mcp_access_groups"].some((key) => stringList(draft[key]).length))
			body.object_permission = Object.fromEntries(
				["vector_stores", "mcp_servers", "mcp_access_groups"]
					.filter((key) => stringList(draft[key]).length)
					.map((key) => [key, draft[key]]),
			);
		return body;
	}
	return {
		organization_id: org.organization_id,
		organization_alias: draft.organization_alias,
		models: draft.models,
		litellm_budget_table: {
			tpm_limit: draft.tpm_limit,
			rpm_limit: draft.rpm_limit,
			max_budget: draft.max_budget,
			budget_duration: draft.budget_duration,
		},
		metadata: draft.metadata ? parseMetadata(draft.metadata) : null,
		object_permission: {
			...org.object_permission,
			vector_stores: stringList(draft.vector_stores),
			mcp_servers: stringList(draft.mcp_servers),
			mcp_access_groups: stringList(draft.mcp_access_groups),
		},
	};
}
