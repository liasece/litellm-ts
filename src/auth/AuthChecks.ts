/**
 * AuthChecks — 授权检查函数集合
 *
 * 等效于 Python litellm-proxy 的 common_checks()。
 * 提供预算限制、并行请求限制、团队阻止状态等检查。
 */

import type { UserAPIKeyAuth } from "../types/auth";
import { ApiError } from "../core/api/ApiError";
import { createModuleLogger } from "../core/utils/logger";
import { BudgetEntity, BudgetAlertType, emitBudgetAlert } from "./BudgetAlerts";

const logger = createModuleLogger("AuthChecks");

/** 数据库团队行类型（用到的字段子集） */
interface TeamRow {
	blocked?: boolean | null;
	spend?: number | null;
	maxBudget?: number | null;
	tpmLimit?: number | null;
	rpmLimit?: number | null;
	maxParallelRequests?: number | null;
	models?: string[] | null;
	modelSpend?: Record<string, number> | null;
	modelMaxBudget?: Record<string, number> | null;
	/** 组织软预算 */
	softBudget?: number | null;
	/** 组织元数据 */
	metadata?: Record<string, unknown> | null;
}

/** 组织行类型（用到的字段子集），对齐 PY OrganizationTable */
interface OrganizationRow {
	blocked?: boolean | null;
	spend?: number | null;
	maxBudget?: number | null;
	softBudget?: number | null;
	metadata?: Record<string, unknown> | null;
}

/** 标签行类型 */
interface TagRow {
	spend?: number | null;
	maxBudget?: number | null;
}

/** 端用户行类型 */
interface EndUserRow {
	blocked?: boolean | null;
	spend?: number | null;
	maxBudget?: number | null;
	softBudget?: number | null;
	metadata?: Record<string, unknown> | null;
	allowedRoutes?: string[] | null;
}

/** 项目行类型，对齐 PY LiteLLM_ProjectTable */
interface ProjectRow {
	blocked?: boolean | null;
	spend?: number | null;
	maxBudget?: number | null;
	tpmLimit?: number | null;
	rpmLimit?: number | null;
	metadata?: Record<string, unknown> | null;
}

/**
 * 检查团队是否被阻止
 * @param team
 * @throws ApiError 401 若团队被阻止
 */
export function isTeamBlocked(team: TeamRow): void {
	if (team.blocked) {
		throw ApiError.unauthorized("所属团队已被禁用");
	}
}

/**
 * 检查密钥是否可以访问指定模型
 * @param model
 * @param allowedModels
 * @param teamModelAliases
 * @returns true 若可访问，false 若被禁止
 */
export function canKeyAccessModel(model: string, allowedModels: string[], teamModelAliases?: Record<string, string>): boolean {
	// 无限制列表，放行
	if (allowedModels.length === 0) {
		return true;
	}

	// 展开模型别名
	const resolvedModel = teamModelAliases?.[model] ?? model;

	// Python LiteLLM: all-team-models 是特殊哨兵，跳过 key 级模型检查，交给 team 级检查。
	if (allowedModels.includes("all-team-models")) {
		return true;
	}

	// 精确匹配
	if (allowedModels.includes(resolvedModel)) {
		return true;
	}

	// 通配符匹配：* 或 anthropic/* 模式
	for (const pattern of allowedModels) {
		if (pattern === "*") {
			return true;
		}
		if (pattern.endsWith("/*") && resolvedModel.startsWith(pattern.slice(0, -1))) {
			return true;
		}
	}

	return false;
}

/**
 * 软预算警告 — 触发已注册的所有报警 channels（Slack/Webhook/Email/...）。
 * GAP: 之前仅 logger.warn，无法通知运维。现在通过 emitBudgetAlert 集中分发。
 * @param spend - 当前花费
 * @param softBudget - 软预算上限
 * @param keyName - 密钥名称（用于日志标识）
 */
export function checkSoftBudget(spend: number, softBudget?: number | null, keyName?: string): void {
	if (softBudget != null && spend >= softBudget) {
		logger.warn(`软预算已超限: spend=${spend}, softBudget=${softBudget}, key=${keyName ?? "unknown"}`);
		// GAP: 触发预算报警 channels（fire-and-forget，不阻塞主路径）
		void emitBudgetAlert({
			type: BudgetAlertType.SoftBudgetExceeded,
			entity: BudgetEntity.Key,
			spend: spend,
			softBudget: softBudget,
			keyName: keyName,
		});
	}
}

/**
 * 检查预算是否超限
 * @param spend - 当前花费
 * @param maxBudget - 最大预算
 * @throws ApiError 429 若超限
 */
export function checkBudget(spend: number, maxBudget?: number | null): void {
	if (maxBudget != null && spend >= maxBudget) {
		throw ApiError.tooManyRequests("预算已超限");
	}
}

/**
 * 检查并行请求数是否超限
 * @param current - 当前并行请求数
 * @param max - 最大允许并行数
 * @throws ApiError 429 若超限
 */
export function checkParallelRequests(current: number, max?: number | null): void {
	if (max != null && current >= max) {
		throw ApiError.tooManyRequests("并行请求数已超限");
	}
}

/**
 * 检查团队是否可以访问指定模型
 * @param team
 * @param model
 * @throws ApiError 403 若不允许
 */
export function canTeamAccessModel(team: TeamRow, model: string): void {
	if (!team.models || team.models.length === 0) {
		return; // 无限制
	}

	if (team.models.includes(model)) {
		return;
	}

	// 通配符匹配
	for (const pattern of team.models) {
		if (pattern === "*") {
			return;
		}
		if (pattern.endsWith("/*") && model.startsWith(pattern.slice(0, -1))) {
			return;
		}
	}

	throw ApiError.unauthorized(`团队无权访问模型: ${model}`);
}

/**
 * PY: check tool allowlist — verify the requested tool is allowed (auth_checks.py:316-361)
 * @param requestedTool - tool name requested in the call
 * @param allowedTools - list of allowed tool names from auth/permissions
 * @throws ApiError 403 if tool not in allowlist
 */
export function checkToolAllowlist(requestedTool: string, allowedTools?: string[] | null): void {
	if (!allowedTools || allowedTools.length === 0) {
		return; // no restrictions
	}
	if (allowedTools.includes(requestedTool) || allowedTools.includes("*")) {
		return;
	}
	// prefix wildcard: "tool_search/*" matches "tool_search/web_search"
	for (const pattern of allowedTools) {
		if (pattern.endsWith("/*") && requestedTool.startsWith(pattern.slice(0, -1))) {
			return;
		}
	}
	throw ApiError.unauthorized(`工具 "${requestedTool}" 未在授权列表中`);
}

/**
 * PY: check vector store access — verify user/token can access the vector store (auth_checks.py:571-576)
 * @param requestedStore - vector store name/ID
 * @param allowedStores - list of allowed store names from auth/permissions
 * @throws ApiError 403 if store not allowed
 */
export function checkVectorStoreAccess(requestedStore: string, allowedStores?: string[] | null): void {
	if (!allowedStores || allowedStores.length === 0) {
		return;
	}
	if (allowedStores.includes(requestedStore) || allowedStores.includes("*")) {
		return;
	}
	throw ApiError.unauthorized(`向量存储 "${requestedStore}" 未在授权列表中`);
}

/**
 * PY: check organization budget (auth_checks.py:488-498)
 * @param org - organization record
 * @throws ApiError 429 if budget exceeded
 */
export function checkOrganizationBudget(org?: OrganizationRow | null): void {
	if (!org) {
		return;
	}
	if (org.maxBudget != null && (org.spend ?? 0) >= org.maxBudget) {
		throw ApiError.tooManyRequests("组织预算已超限");
	}
	if (org.softBudget != null && (org.spend ?? 0) >= org.softBudget) {
		logger.warn(`组织软预算已超限: spend=${org.spend}, softBudget=${org.softBudget}`);
		// GAP: 触发预算报警 channels
		void emitBudgetAlert({
			type: BudgetAlertType.SoftBudgetExceeded,
			entity: BudgetEntity.Organization,
			spend: org.spend ?? 0,
			softBudget: org.softBudget,
		});
	}
}

/**
 * PY: check tag budget (auth_checks.py:499-506)
 * @param tag - tag record
 * @throws ApiError 429 if budget exceeded
 */
export function checkTagBudget(tag?: TagRow | null): void {
	if (!tag) {
		return;
	}
	if (tag.maxBudget != null && (tag.spend ?? 0) >= tag.maxBudget) {
		throw ApiError.tooManyRequests("标签预算已超限");
	}
}

/**
 * PY: check end_user budget (auth_checks.py:535-545)
 * @param endUser - end_user record
 * @throws ApiError 429 if budget exceeded
 */
export function checkEndUserBudget(endUser?: EndUserRow | null): void {
	if (!endUser) {
		return;
	}
	if (endUser.blocked) {
		throw ApiError.unauthorized("端用户已被禁用");
	}
	if (endUser.maxBudget != null && (endUser.spend ?? 0) >= endUser.maxBudget) {
		throw ApiError.tooManyRequests("端用户预算已超限");
	}
	if (endUser.softBudget != null && (endUser.spend ?? 0) >= endUser.softBudget) {
		logger.warn(`端用户软预算已超限: spend=${endUser.spend}, softBudget=${endUser.softBudget}`);
		// GAP: 触发预算报警 channels
		void emitBudgetAlert({
			type: BudgetAlertType.SoftBudgetExceeded,
			entity: BudgetEntity.EndUser,
			spend: endUser.spend ?? 0,
			softBudget: endUser.softBudget,
		});
	}
}

/**
 * PY: check team member budget (auth_checks.py:524-532)
 * @param teamMemberSpend - team member's current spend
 * @param teamMemberMaxBudget - team member's max budget
 * @param teamMemberUserId - user ID for logging
 * @throws ApiError 429 if budget exceeded
 */
export function checkTeamMemberBudget(teamMemberSpend: number, teamMemberMaxBudget?: number | null, teamMemberUserId?: string): void {
	if (teamMemberMaxBudget != null && teamMemberSpend >= teamMemberMaxBudget) {
		logger.warn(
			`团队成员预算已超限: userId=${teamMemberUserId ?? "unknown"}, spend=${teamMemberSpend}, maxBudget=${teamMemberMaxBudget}`,
		);
		throw ApiError.tooManyRequests("团队成员预算已超限");
	}
}

/**
 * PY: check project constraints (auth_checks.py:184-227)
 * @param project - project record
 * @throws ApiError if blocked or budget exceeded
 */
export function checkProjectAccess(project?: ProjectRow | null): void {
	if (!project) {
		return;
	}
	if (project.blocked) {
		throw ApiError.unauthorized("项目已被禁用");
	}
	if (project.maxBudget != null && (project.spend ?? 0) >= project.maxBudget) {
		throw ApiError.tooManyRequests("项目预算已超限");
	}
}

/** 并行请求追踪 */
const parallelCounts = new Map<string, number>();

/**
 * 追踪并行请求数
 * @param userId - 用户标识
 * @param delta - 变化量（1 增加，-1 减少）
 */
export function trackParallelRequest(userId: string, delta: 1 | -1): void {
	const current = parallelCounts.get(userId) ?? 0;
	parallelCounts.set(userId, Math.max(0, current + delta));
}

/**
 * 获取指定用户的当前并行请求数
 * @param userId - 用户标识
 */
export function getActiveParallel(userId: string): number {
	return parallelCounts.get(userId) ?? 0;
}

/**
 * 运行所有通用授权检查
 * @param auth - API 密钥认证上下文
 * @param model - 当前请求的目标模型
 * @param team - 团队记录（可选）
 * @throws {ApiError} 当检查不通过时抛出
 */
export function runCommonChecks(auth: UserAPIKeyAuth, model: string, team?: TeamRow | null): void {
	// 1. 检查密钥是否被阻止
	if (auth.blocked) {
		throw ApiError.unauthorized("API 密钥已被禁用");
	}

	// 2. 检查密钥是否过期
	if (auth.expires && new Date(auth.expires) < new Date()) {
		throw ApiError.unauthorized("API 密钥已过期");
	}

	// 3. 检查 TPM/RPM/并行限制 (Python: common_checks)
	if (auth.tpm_limit != null && auth.tpm_limit > 0) {
		// TPM check delegated to Router's TPMRPMLimiter
	}
	if (auth.rpm_limit != null && auth.rpm_limit > 0) {
		// RPM check delegated to Router's TPMRPMLimiter
	}
	if (auth.max_parallel_requests != null && auth.max_parallel_requests > 0) {
		checkParallelRequests(getActiveParallel(auth.user_id ?? ""), auth.max_parallel_requests);
	}

	// 4. 检查团队是否被阻止
	if (team) {
		isTeamBlocked(team);
	}

	// 5. 检查模型访问权限（含团队别名展开）
	if (auth.models && auth.models.length > 0) {
		if (!canKeyAccessModel(model, auth.models, auth.team_model_aliases)) {
			throw ApiError.unauthorized(`API 密钥无权访问模型: ${model}`);
		}
	}

	// 6. 检查团队模型访问权限
	if (team) {
		canTeamAccessModel(team, model);
	}

	// 7. 独立检查每个预算主体，禁止把 key/team 等 spend 合并后与单一上限比较。
	const snapshots = auth.budget_snapshots;
	if (snapshots) {
		for (const snapshot of Object.values(snapshots)) {
			if (snapshot) {
				checkBudget(snapshot.spend, snapshot.max_budget);
			}
		}
	} else if (auth.max_budget != null) {
		// 兼容 master key/JWT 或旧调用方尚未提供快照的认证上下文。
		checkBudget(auth.spend ?? 0, auth.max_budget);
	}

	// 8. 检查软预算（仅日志，不抛异常）
	checkSoftBudget(auth.spend ?? 0, auth.soft_budget, auth.key_name ?? "unknown");
}
