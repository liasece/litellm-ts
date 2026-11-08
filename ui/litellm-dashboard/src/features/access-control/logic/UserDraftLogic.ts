import { objectValue, parseMetadata, stringList } from "./ResourceDraftLogic";
import type { AccessRecord, AccessUser } from "../support/AccessModels";
export function createUserDraft(user?: AccessUser): AccessRecord {
	return user
		? {
				user_id: user.user_id,
				user_email: user.user_email,
				user_alias: user.user_alias,
				user_role: user.user_role,
				models: [...user.models],
				max_budget: user.max_budget ?? null,
				budget_duration: user.budget_duration,
				metadata: user.metadata ? JSON.stringify(user.metadata, null, 2) : undefined,
			}
		: { models: [] };
}
export function buildInviteUserPayload(value: AccessRecord): AccessRecord {
	const result = { ...value };
	if (!stringList(result.models).length && result.user_role !== "proxy_admin") result.models = ["no-default-models"];
	if (result.organization_ids) {
		result.organizations = result.organization_ids;
		delete result.organization_ids;
	}
	if (result.metadata) result.metadata = parseMetadata(result.metadata);
	return result;
}
export function buildUserUpdatePayload(value: AccessRecord, unlimited: boolean): AccessRecord {
	return {
		...value,
		...(value.metadata ? { metadata: parseMetadata(value.metadata) } : {}),
		max_budget: unlimited || value.max_budget === "" || value.max_budget === undefined ? null : value.max_budget,
	};
}
export function buildBulkUserPayload(value: AccessRecord): AccessRecord {
	const result: AccessRecord = {};
	if (value.user_role) result.user_role = value.user_role;
	if (value.max_budget != null) result.max_budget = value.max_budget;
	if (stringList(value.models).length) result.models = value.models;
	if (value.budget_duration) result.budget_duration = value.budget_duration;
	if (Object.keys(objectValue(value.metadata)).length) result.metadata = value.metadata;
	return result;
}
export function buildInvitationUrl(baseUrl: string, value: AccessRecord | null, reset = false): string {
	if (!baseUrl) return "";
	const base = new URL(baseUrl),
		basePath = base.pathname;
	const uiPath = basePath && basePath !== "/" ? basePath + "/ui" : "ui";
	if (value?.has_user_setup_sso) return new URL(uiPath, baseUrl).toString();
	return new URL(uiPath + "?invitation_id=" + value?.id + (reset ? "&action=reset_password" : ""), baseUrl).toString();
}
