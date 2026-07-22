/**
 * Python LiteLLM 管理端点响应行序列化器（共享模块）
 *
 * 各管理端点（key/user/team/customer/model）写操作的响应均需逐字段对齐 Python 版实测结构
 * （键集合 + 类型 + snake_case 命名）。序列化逻辑集中在此，避免各端点文件重复实现。
 * 字段集以 Python 版（192.168.1.220:4000）实测响应为准；
 * 协议源码：litellm/proxy/_types.py、litellm/proxy/management_endpoints/*.py。
 */

import type { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import type { LiteLLM_UserTable } from "../db/schema/users";
import type { LiteLLM_TeamTable } from "../db/schema/teams";
import type { LiteLLM_EndUserTable } from "../db/schema/end-users";
import type { LiteLLM_ObjectPermissionTable } from "../db/schema/object-permissions";
import type { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";

/**
 *
 */
export type VerificationTokenRow = typeof LiteLLM_VerificationToken.$inferSelect;
/**
 *
 */
export type InternalUserRow = typeof LiteLLM_UserTable.$inferSelect;
/**
 *
 */
export type TeamRow = typeof LiteLLM_TeamTable.$inferSelect;
/**
 *
 */
export type EndUserRow = typeof LiteLLM_EndUserTable.$inferSelect;
/**
 *
 */
export type ObjectPermissionRow = typeof LiteLLM_ObjectPermissionTable.$inferSelect;
/**
 *
 */
export type OrganizationMembershipRow = typeof LiteLLM_OrganizationMembership.$inferSelect;

const EMPTY_STRING_ARRAY: readonly string[] = [];
const EMPTY_JSON_OBJECT: Readonly<Record<string, never>> = {};

/** Python UpdateRouterConfig 全字段缺省值（实测 /key/generate、/user/new 响应中 router_settings 的展开形态）。 */
export const DEFAULT_ROUTER_SETTINGS: Readonly<Record<string, unknown>> = {
	routing_strategy_args: null,
	routing_strategy: null,
	model_group_retry_policy: null,
	model_group_affinity_config: null,
	allowed_fails: null,
	cooldown_time: null,
	num_retries: null,
	timeout: null,
	max_retries: null,
	retry_after: null,
	fallbacks: null,
	context_window_fallbacks: null,
	model_group_alias: {},
};

/**
 * ObjectPermission 行 → Python LiteLLM_ObjectPermissionTable 响应字段（snake_case）。
 * 协议源码：litellm/proxy/_types.py LiteLLM_ObjectPermissionTable。
 * @param row
 */
export function toPythonObjectPermission(row: ObjectPermissionRow): Record<string, unknown> {
	return {
		object_permission_id: row.objectPermissionId,
		mcp_servers: row.mcpServers ?? EMPTY_STRING_ARRAY,
		mcp_access_groups: row.mcpAccessGroups ?? EMPTY_STRING_ARRAY,
		mcp_tool_permissions: row.mcpToolPermissions ?? null,
		vector_stores: row.vectorStores ?? EMPTY_STRING_ARRAY,
		agents: row.agents ?? EMPTY_STRING_ARRAY,
		agent_access_groups: row.agentAccessGroups ?? EMPTY_STRING_ARRAY,
	};
}

/**
 * OrganizationMembership 行 → Python LiteLLM_OrganizationMembershipTable 响应字段（snake_case）。
 * @param row
 */
export function toPythonOrganizationMembership(row: OrganizationMembershipRow): Record<string, unknown> {
	return {
		user_id: row.userId,
		organization_id: row.organizationId,
		user_role: row.userRole,
		spend: row.spend ?? 0,
		budget_id: row.budgetId,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
	};
}

/** toPythonKeyManagementRow 的关联数据与选项。 */
export interface PythonKeyRowOptions {
	/** 是否包含 token（hash）字段：/key/update、/user/info 含；/team/info 不含 */
	readonly includeToken: boolean;
	/** 关联预算行（budget_id 非空时由调用方加载），无关联为 null */
	readonly budgetRow?: Record<string, unknown> | null;
	/** 关联对象权限行（object_permission_id 非空时由调用方加载），无关联为 null */
	readonly objectPermissionRow?: ObjectPermissionRow | null;
	/** 所属团队别名：team_id 为 null 时 Python 序列化为字符串 "None"；团队不存在为 null */
	readonly teamAlias?: string | null;
}

/**
 * VerificationToken 行 → Python LiteLLM_VerificationToken 完整响应字段（48 键 + 可选 team_alias）。
 * 用于 /key/update（含 token）、/user/info keys（含 token + team_alias）、/team/info keys（不含 token）。
 * 关联字段 litellm_organization_table / litellm_project_table / jwt_key_mappings 当前恒为 null。
 * @param row
 * @param options
 */
export function toPythonKeyManagementRow(row: VerificationTokenRow, options: PythonKeyRowOptions): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	if (options.includeToken) {
		output["token"] = row.token;
	}
	Object.assign(output, {
		key_name: row.keyName,
		key_alias: row.keyAlias,
		soft_budget_cooldown: row.softBudgetCooldown ?? false,
		spend: row.spend ?? 0,
		expires: row.expires,
		models: row.models ?? EMPTY_STRING_ARRAY,
		aliases: row.aliases ?? EMPTY_JSON_OBJECT,
		config: row.config ?? EMPTY_JSON_OBJECT,
		router_settings: row.routerSettings ?? EMPTY_JSON_OBJECT,
		user_id: row.userId,
		team_id: row.teamId,
		agent_id: row.agentId,
		project_id: row.projectId,
		permissions: row.permissions ?? EMPTY_JSON_OBJECT,
		max_parallel_requests: row.maxParallelRequests,
		metadata: row.metadata ?? EMPTY_JSON_OBJECT,
		blocked: row.blocked,
		tpm_limit: row.tpmLimit,
		rpm_limit: row.rpmLimit,
		max_budget: row.maxBudget,
		budget_duration: row.budgetDuration,
		budget_reset_at: row.budgetResetAt,
		allowed_cache_controls: row.allowedCacheControls ?? EMPTY_STRING_ARRAY,
		allowed_routes: row.allowedRoutes ?? EMPTY_STRING_ARRAY,
		policies: row.policies ?? EMPTY_STRING_ARRAY,
		access_group_ids: row.accessGroupIds ?? EMPTY_STRING_ARRAY,
		model_spend: row.modelSpend ?? EMPTY_JSON_OBJECT,
		model_max_budget: row.modelMaxBudget ?? EMPTY_JSON_OBJECT,
		budget_id: row.budgetId,
		organization_id: row.organizationId,
		object_permission_id: row.objectPermissionId,
		created_at: row.createdAt,
		created_by: row.createdBy,
		updated_at: row.updatedAt,
		updated_by: row.updatedBy,
		last_active: row.lastActive,
		rotation_count: row.rotationCount ?? 0,
		auto_rotate: row.autoRotate ?? false,
		rotation_interval: row.rotationInterval,
		last_rotation_at: row.lastRotationAt,
		key_rotation_at: row.keyRotationAt,
		litellm_budget_table: options.budgetRow ?? null,
		litellm_organization_table: null,
		litellm_project_table: null,
		object_permission: options.objectPermissionRow ? toPythonObjectPermission(options.objectPermissionRow) : null,
		jwt_key_mappings: null,
	});
	if (options.teamAlias !== undefined) {
		output["team_alias"] = options.teamAlias;
	}
	return output;
}

/** toPythonInternalUserRow 的关联数据与选项。 */
export interface PythonInternalUserRowOptions {
	/**
	 * organization_memberships 字段值：
	 * /user/update 实测为 null；/user/info 为实测数组（无成员关系为空数组 []）
	 */
	readonly organizationMemberships: readonly Record<string, unknown>[] | null;
	/** 关联对象权限行（object_permission_id 非空时由调用方加载），无关联为 null */
	readonly objectPermissionRow?: ObjectPermissionRow | null;
}

/**
 * User 行 → Python LiteLLM_UserTable 完整响应字段（31 键）。
 * 用于 /user/update data、/user/info user_info。
 * 关联字段 litellm_organization_table / invitations_* 当前恒为 null。
 * @param row
 * @param options
 */
export function toPythonInternalUserRow(row: InternalUserRow, options: PythonInternalUserRowOptions): Record<string, unknown> {
	return {
		user_id: row.userId,
		user_alias: row.userAlias,
		team_id: row.teamId,
		sso_user_id: row.ssoUserId,
		organization_id: row.organizationId,
		object_permission_id: row.objectPermissionId,
		password: row.password,
		teams: row.teams ?? EMPTY_STRING_ARRAY,
		user_role: row.userRole,
		max_budget: row.maxBudget,
		spend: row.spend ?? 0,
		user_email: row.userEmail,
		models: row.models ?? EMPTY_STRING_ARRAY,
		metadata: row.metadata ?? EMPTY_JSON_OBJECT,
		max_parallel_requests: row.maxParallelRequests,
		tpm_limit: row.tpmLimit,
		rpm_limit: row.rpmLimit,
		budget_duration: row.budgetDuration,
		budget_reset_at: row.budgetResetAt,
		allowed_cache_controls: row.allowedCacheControls ?? EMPTY_STRING_ARRAY,
		policies: row.policies ?? EMPTY_STRING_ARRAY,
		model_spend: row.modelSpend ?? EMPTY_JSON_OBJECT,
		model_max_budget: row.modelMaxBudget ?? EMPTY_JSON_OBJECT,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		litellm_organization_table: null,
		organization_memberships: options.organizationMemberships,
		invitations_created: null,
		invitations_updated: null,
		invitations_user: null,
		object_permission: options.objectPermissionRow ? toPythonObjectPermission(options.objectPermissionRow) : null,
	};
}

/**
 * Team 行 → Python LiteLLM_TeamTable 响应字段（26 键）。
 * 用于 /team/new、/team/info team_info（追加 team_member_budget_table）、/user/info teams。
 * 关联字段 litellm_model_table / object_permission 当前恒为 null。
 * @param row
 */
export function toPythonTeamRow(row: TeamRow): Record<string, unknown> {
	return {
		team_alias: row.teamAlias,
		team_id: row.teamId,
		organization_id: row.organizationId,
		admins: row.admins ?? EMPTY_STRING_ARRAY,
		members: row.members ?? EMPTY_STRING_ARRAY,
		members_with_roles: row.membersWithRoles ?? EMPTY_STRING_ARRAY,
		team_member_permissions: row.teamMemberPermissions ?? EMPTY_STRING_ARRAY,
		metadata: row.metadata ?? EMPTY_JSON_OBJECT,
		tpm_limit: row.tpmLimit,
		rpm_limit: row.rpmLimit,
		max_budget: row.maxBudget,
		soft_budget: row.softBudget,
		budget_duration: row.budgetDuration,
		models: row.models ?? EMPTY_STRING_ARRAY,
		blocked: row.blocked ?? false,
		router_settings: row.routerSettings ?? EMPTY_JSON_OBJECT,
		access_group_ids: row.accessGroupIds ?? EMPTY_STRING_ARRAY,
		spend: row.spend ?? 0,
		max_parallel_requests: row.maxParallelRequests,
		budget_reset_at: row.budgetResetAt,
		model_id: row.modelId,
		litellm_model_table: null,
		object_permission: null,
		updated_at: row.updatedAt,
		created_at: row.createdAt,
		object_permission_id: row.objectPermissionId,
	};
}

/**
 * Team 行 → Python /team/update 实测 data 字段（32 键，Prisma 行全集 + 关联字段）。
 * 与 toPythonTeamRow（26 键 LiteLLM_TeamTable pydantic 形状）是两种不同的实测形状，不可混用。
 * 关联字段 litellm_organization_table / litellm_model_table / object_permission / projects 当前恒为 null。
 * @param row
 */
export function toPythonTeamUpdateDataRow(row: TeamRow): Record<string, unknown> {
	return {
		team_id: row.teamId,
		team_alias: row.teamAlias,
		organization_id: row.organizationId,
		object_permission_id: row.objectPermissionId,
		admins: row.admins ?? EMPTY_STRING_ARRAY,
		members: row.members ?? EMPTY_STRING_ARRAY,
		members_with_roles: row.membersWithRoles ?? EMPTY_STRING_ARRAY,
		metadata: row.metadata ?? EMPTY_JSON_OBJECT,
		max_budget: row.maxBudget,
		soft_budget: row.softBudget,
		spend: row.spend ?? 0,
		models: row.models ?? EMPTY_STRING_ARRAY,
		max_parallel_requests: row.maxParallelRequests,
		tpm_limit: row.tpmLimit,
		rpm_limit: row.rpmLimit,
		budget_duration: row.budgetDuration,
		budget_reset_at: row.budgetResetAt,
		blocked: row.blocked ?? false,
		created_at: row.createdAt,
		updated_at: row.updatedAt,
		model_spend: row.modelSpend ?? EMPTY_JSON_OBJECT,
		model_max_budget: row.modelMaxBudget ?? EMPTY_JSON_OBJECT,
		router_settings: row.routerSettings ?? EMPTY_JSON_OBJECT,
		team_member_permissions: row.teamMemberPermissions ?? EMPTY_STRING_ARRAY,
		access_group_ids: row.accessGroupIds ?? EMPTY_STRING_ARRAY,
		policies: row.policies ?? EMPTY_STRING_ARRAY,
		model_id: row.modelId,
		allow_team_guardrail_config: row.allowTeamGuardrailConfig ?? false,
		litellm_organization_table: null,
		litellm_model_table: null,
		object_permission: null,
		projects: null,
	};
}

/** toPythonEndUserRow 的关联数据。 */
export interface PythonEndUserRowOptions {
	/** 关联预算行（budget_id 非空时由调用方加载），无关联为 null */
	readonly budgetRow?: Record<string, unknown> | null;
	/** 关联对象权限行（object_permission_id 非空时由调用方加载），无关联为 null */
	readonly objectPermissionRow?: ObjectPermissionRow | null;
}

/**
 * EndUser 行 → Python /customer/new、/customer/update 实测响应字段（10 键）。
 * 协议源码：litellm/proxy/management_endpoints/customer_endpoints.py。
 * @param row
 * @param options
 */
export function toPythonEndUserWriteRow(row: EndUserRow, options: PythonEndUserRowOptions): Record<string, unknown> {
	return {
		user_id: row.userId,
		alias: row.alias,
		spend: row.spend ?? 0,
		allowed_model_region: row.allowedModelRegion,
		default_model: row.defaultModel,
		budget_id: row.budgetId,
		object_permission_id: row.objectPermissionId,
		litellm_budget_table: options.budgetRow ?? null,
		object_permission: options.objectPermissionRow ? toPythonObjectPermission(options.objectPermissionRow) : null,
		blocked: row.blocked ?? false,
	};
}

/** buildGenerateKeyResponse 入参。 */
export interface GenerateKeyResponseParams {
	/**
	 *
	 */
	readonly body: Record<string, unknown>;
	/**
	 *
	 */
	readonly plainKey: string;
	/**
	 *
	 */
	readonly tokenHash: string;
	/**
	 *
	 */
	readonly keyName: string;
	/**
	 *
	 */
	readonly expires: Date | null;
	/**
	 *
	 */
	readonly createdBy: string | null;
	/**
	 *
	 */
	readonly now: Date;
	/**
	 *
	 */
	readonly budgetRow: Record<string, unknown> | null;
}

/**
 * 构造 /key/generate 的 Python GenerateKeyResponse 完整字段集（48 键）。
 * 协议源码：litellm/proxy/_types.py GenerateKeyResponse / KeyRequestBase。
 * 字段命名与缺省值以 Python 版实测响应为准（DB 未覆盖的字段按 Python 缺省 null/{}/[] 返回）。
 * /user/new 复用后需按 Python 实测覆盖 token_id/token/created_by/updated_by 为 null。
 * @param params
 */
export function buildGenerateKeyResponse(params: GenerateKeyResponseParams): Record<string, unknown> {
	const { body, plainKey, tokenHash, keyName, expires, createdBy, now, budgetRow } = params;
	const pick = (name: string, fallback: unknown): unknown => (body[name] !== undefined && body[name] !== null ? body[name] : fallback);
	const requestRouterSettings =
		body["router_settings"] !== null && typeof body["router_settings"] === "object"
			? (body["router_settings"] as Record<string, unknown>)
			: {};
	return {
		key_alias: pick("key_alias", null),
		duration: pick("duration", null),
		models: pick("models", []),
		spend: 0,
		max_budget: pick("max_budget", null),
		user_id: pick("user_id", null),
		team_id: pick("team_id", null),
		agent_id: pick("agent_id", null),
		max_parallel_requests: pick("max_parallel_requests", null),
		metadata: pick("metadata", {}),
		tpm_limit: pick("tpm_limit", null),
		rpm_limit: pick("rpm_limit", null),
		budget_duration: pick("budget_duration", null),
		allowed_cache_controls: pick("allowed_cache_controls", []),
		config: pick("config", {}),
		permissions: pick("permissions", {}),
		model_max_budget: pick("model_max_budget", {}),
		model_rpm_limit: pick("model_rpm_limit", null),
		model_tpm_limit: pick("model_tpm_limit", null),
		guardrails: pick("guardrails", null),
		policies: pick("policies", null),
		prompts: pick("prompts", null),
		blocked: pick("blocked", null),
		aliases: pick("aliases", {}),
		object_permission: pick("object_permission", null),
		key: plainKey,
		budget_id: pick("budget_id", null),
		tags: pick("tags", null),
		enforced_params: pick("enforced_params", null),
		allowed_routes: pick("allowed_routes", []),
		allowed_passthrough_routes: pick("allowed_passthrough_routes", null),
		allowed_vector_store_indexes: pick("allowed_vector_store_indexes", null),
		rpm_limit_type: pick("rpm_limit_type", null),
		tpm_limit_type: pick("tpm_limit_type", null),
		router_settings: { ...DEFAULT_ROUTER_SETTINGS, ...requestRouterSettings },
		access_group_ids: pick("access_group_ids", []),
		key_name: keyName,
		expires: expires,
		token_id: tokenHash,
		organization_id: pick("organization_id", null),
		project_id: pick("project_id", null),
		litellm_budget_table: budgetRow,
		token: tokenHash,
		created_by: createdBy,
		updated_by: createdBy,
		created_at: now,
		updated_at: now,
	};
}

/**
 * Python str(list) 风格的字符串数组字面量（['a', 'b']），
 * 用于 /customer/delete 响应 message 等需要与 Python 文本完全一致的场景。
 * @param values
 */
export function pythonListRepr(values: readonly string[]): string {
	return `[${values.map((value) => `'${value}'`).join(", ")}]`;
}
