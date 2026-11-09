import { parseMetadata } from "./ResourceDraftLogic";
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
export function buildUserUpdatePayload(value: AccessRecord, unlimited: boolean): AccessRecord {
	return {
		...value,
		...(value.metadata ? { metadata: parseMetadata(value.metadata) } : {}),
		max_budget: unlimited || value.max_budget === "" || value.max_budget === undefined ? null : value.max_budget,
	};
}
