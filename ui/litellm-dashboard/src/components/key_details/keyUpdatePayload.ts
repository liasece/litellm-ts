import { mapEmptyStringToNull } from "@/utils/keyUpdateUtils";
import { mapDisplayToInternalNames } from "../callback_info_helpers";
import type { KeyResponse } from "../key_team_helpers/key_list";

const nullableNumericFields = ["max_budget", "tpm_limit", "rpm_limit", "max_parallel_requests"] as const;

export function buildKeyUpdatePayload(
	formValues: Record<string, any>,
	currentKey: KeyResponse,
	canEditGuardrails: boolean,
) {
	const payload: Record<string, any> = { ...formValues, key: formValues.token };

	if (!canEditGuardrails) {
		delete payload.guardrails;
		delete payload.prompts;
	}

	for (const field of nullableNumericFields) {
		payload[field] = mapEmptyStringToNull(payload[field]);
	}

	let objectPermission = { ...currentKey.object_permission };
	let objectPermissionChanged = false;

	if (payload.vector_stores !== undefined) {
		objectPermission = { ...objectPermission, vector_stores: payload.vector_stores || [] };
		objectPermissionChanged = true;
		delete payload.vector_stores;
	}

	if (payload.mcp_servers_and_groups !== undefined) {
		const { servers = [], accessGroups = [] } = payload.mcp_servers_and_groups || {};
		objectPermission = {
			...objectPermission,
			mcp_servers: servers,
			mcp_access_groups: accessGroups,
		};
		objectPermissionChanged = true;
		delete payload.mcp_servers_and_groups;
	}

	if (payload.mcp_tool_permissions !== undefined) {
		objectPermission = {
			...objectPermission,
			mcp_tool_permissions: payload.mcp_tool_permissions || {},
		};
		objectPermissionChanged = true;
		delete payload.mcp_tool_permissions;
	}

	if (payload.agents_and_groups !== undefined) {
		const { agents = [], accessGroups = [] } = payload.agents_and_groups || {};
		objectPermission = {
			...objectPermission,
			agents,
			agent_access_groups: accessGroups,
		};
		objectPermissionChanged = true;
		delete payload.agents_and_groups;
	}

	if (objectPermissionChanged) {
		payload.object_permission = objectPermission;
	}

	const rawMetadata =
		typeof payload.metadata === "string" ? JSON.parse(payload.metadata || "{}") : payload.metadata || {};
	const { tags: _omittedTags, ...metadata } = rawMetadata;
	payload.metadata = {
		...metadata,
		...(Array.isArray(payload.tags) && payload.tags.length > 0 ? { tags: payload.tags } : {}),
		...(payload.guardrails?.length > 0 ? { guardrails: payload.guardrails } : {}),
		...(Array.isArray(payload.logging_settings) && payload.logging_settings.length > 0
			? { logging: payload.logging_settings }
			: {}),
		...(payload.disabled_callbacks?.length > 0
			? { litellm_disabled_callbacks: mapDisplayToInternalNames(payload.disabled_callbacks) }
			: {}),
	};

	delete payload.tags;
	delete payload.logging_settings;

	if (payload.budget_duration) {
		const durationMap: Record<string, string> = {
			daily: "24h",
			weekly: "7d",
			monthly: "30d",
		};
		payload.budget_duration = durationMap[payload.budget_duration] ?? payload.budget_duration;
	}

	return payload;
}
