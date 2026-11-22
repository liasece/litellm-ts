/**
 * Spend 日志的认证可见性边界。
 *
 * Logs 列表、Session 计数与详情、Session 时间线及其实流都是同一份日志数据的读取入口，
 * 必须给出相同的裁剪结果。把管理员判定与可见性条件集中在这里，新入口复用同一实现，
 * 不再各自复制一份条件，也就不会因为某处漏改而让低权限用户读到别人的日志。
 *
 * 条件片段由仓储提供（`SpendAggregationRepository`）：表列只允许出现在仓储里，本文件
 * 只决定「按什么维度裁剪」，不再 import 表符号或拼 drizzle 查询。团队 admin 校验走
 * `TeamRepository`，与鉴权链读的是同一份按键缓存。
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { ApiError } from "../core/api/ApiError";
import {
	activeRequestTeamVisibilityClause,
	activeRequestUserVisibilityClause,
	spendAggregationRepositoryFor,
	spendTeamVisibilityClause,
	spendUserVisibilityClause,
	visibleToAllClause,
	visibleToNothingClause,
} from "../repositories/SpendAggregationRepository";
import { teamRepositoryFor } from "../repositories/TeamRepository";
import type { UserAPIKeyAuth } from "../types/auth";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";

/** Python LiteLLM proxy admin viewer 角色字面量。 */
const PROXY_ADMIN_VIEWER_ROLE = "proxy_admin_viewer";

/** Python LiteLLM internal user 角色字面量。 */
const INTERNAL_USER_ROLE = "internal_user";
const INTERNAL_USER_VIEWER_ROLE = "internal_user_viewer";

/** HTTP 403 Forbidden 字面量。 */
const HTTP_FORBIDDEN = 403;

/**
 * 可见性条件片段的返回类型。
 *
 * 用仓储函数的返回值反推，避免业务文件再 import drizzle 的类型；片段本身仍由仓储构造。
 */
type VisibilityClause = ReturnType<typeof spendTeamVisibilityClause>;

/**
 * 是否按管理员视角读取（proxy admin 与只读 viewer）。
 * @param auth - 请求认证信息
 */
export function isSpendAdminView(auth: UserAPIKeyAuth | undefined): boolean {
	return !!auth && (auth.user_role === PROXY_ADMIN_ROLE || auth.user_role === PROXY_ADMIN_VIEWER_ROLE);
}

/**
 * 判断用户角色是否为 internal_user / internal_user_viewer（Python `_can_user_view_spend_log`）。
 * @param auth - 请求认证信息
 */
export function isInternalUserRole(auth: UserAPIKeyAuth | undefined): boolean {
	if (!auth) {
		return false;
	}
	return auth.user_role === INTERNAL_USER_ROLE || auth.user_role === INTERNAL_USER_VIEWER_ROLE;
}

/**
 * 列表、Session count、Session detail 与时间线流共用的认证可见性边界。
 * @param db - 数据库实例
 * @param auth - 请求认证信息
 * @param requestedTeamId - 调用方显式指定的 team
 * @throws {ApiError} 指定 team 不可见时抛 403
 */
export async function resolveSpendVisibilityClause(
	db: NodePgDatabase<typeof schema>,
	auth: UserAPIKeyAuth | undefined,
	requestedTeamId?: string,
): Promise<VisibilityClause> {
	if (isSpendAdminView(auth)) {
		return requestedTeamId === undefined ? visibleToAllClause() : spendTeamVisibilityClause(requestedTeamId);
	}
	if (requestedTeamId !== undefined) {
		if (!(await canTeamMemberViewLog(db, auth, requestedTeamId))) {
			throw new ApiError(HTTP_FORBIDDEN, "Not authorized to view requested team spend");
		}
		return spendTeamVisibilityClause(requestedTeamId);
	}
	if (isInternalUserRole(auth) && auth?.user_id) {
		return spendUserVisibilityClause(auth.user_id);
	}
	if (auth?.team_id) {
		return spendTeamVisibilityClause(auth.team_id);
	}
	if (auth?.user_id) {
		return spendUserVisibilityClause(auth.user_id);
	}
	return visibleToNothingClause();
}

/**
 * ActiveRequests 使用与 SpendLogs 相同的可见性决策。requestedTeamId 的成员校验已由
 * resolveSpendVisibilityClause 完成，此处只把同一决策映射到活跃表列。
 * @param auth - 请求认证信息
 * @param requestedTeamId - 调用方显式指定的 team
 */
export function resolveActiveRequestVisibilityClause(auth: UserAPIKeyAuth | undefined, requestedTeamId?: string): VisibilityClause {
	if (isSpendAdminView(auth)) {
		return requestedTeamId === undefined ? visibleToAllClause() : activeRequestTeamVisibilityClause(requestedTeamId);
	}
	if (requestedTeamId !== undefined) {
		return activeRequestTeamVisibilityClause(requestedTeamId);
	}
	if (isInternalUserRole(auth) && auth?.user_id) {
		return activeRequestUserVisibilityClause(auth.user_id);
	}
	if (auth?.team_id) {
		return activeRequestTeamVisibilityClause(auth.team_id);
	}
	if (auth?.user_id) {
		return activeRequestUserVisibilityClause(auth.user_id);
	}
	return visibleToNothingClause();
}

/**
 * 把一批 request_id 裁剪到当前调用方可见的集合。
 *
 * 详情、批量详情和详情 WebSocket 都是按 request_id 直接读；如果只在列表上做可见性，
 * 知道 ID 的低权限调用方仍能绕过列表读到别人的正文。管理员保持原有“全量可读”，
 * 避免为每次详情多打一次存在性查询；非管理员必须先通过可见性条件命中行。
 * @param db - 数据库实例
 * @param auth - 请求认证信息
 * @param requestIds - 待检查的 request_id
 * @param requestedTeamId - 调用方显式指定的 team
 * @throws {ApiError} 指定 team 不可见时抛 403
 */
export async function filterVisibleSpendRequestIds(
	db: NodePgDatabase<typeof schema>,
	auth: UserAPIKeyAuth | undefined,
	requestIds: readonly string[],
	requestedTeamId?: string,
): Promise<Set<string>> {
	const unique = [...new Set(requestIds.filter((requestId) => requestId.length > 0))];
	if (isSpendAdminView(auth)) {
		return new Set(unique);
	}
	if (unique.length === 0) {
		return new Set();
	}
	const spendClause = await resolveSpendVisibilityClause(db, auth, requestedTeamId);
	const activeClause = resolveActiveRequestVisibilityClause(auth, requestedTeamId);
	return await spendAggregationRepositoryFor(db).listVisibleRequestIds(unique, spendClause, activeClause);
}

/**
 * Python `_can_team_member_view_log`：team 存在且用户在 team admins 列表中。
 *
 * 读整行而不是两列投影：团队行本来就被鉴权链按主键缓存，这里复用同一份键，
 * 非管理员指定 team 的校验不会再多打一条独立查询；membersWithRoles 里 role=admin
 * 与 admins 数组等价，两者都要认，否则团队管理员会被自己团队的日志挡在 403。
 * @param db - 数据库实例
 * @param auth - 请求认证信息
 * @param teamId - 待检查的 team
 */
async function canTeamMemberViewLog(db: NodePgDatabase<typeof schema>, auth: UserAPIKeyAuth | undefined, teamId: string): Promise<boolean> {
	if (!auth || !auth.user_id) {
		return false;
	}
	const team = await teamRepositoryFor(db).findById(teamId);
	if (!team) {
		return false;
	}
	const adminList = Array.isArray(team.admins) ? team.admins : [];
	if (adminList.includes(auth.user_id)) {
		return true;
	}
	const roles = (team.membersWithRoles as Record<string, { role?: string }> | null) ?? null;
	const role = roles?.[auth.user_id]?.role;
	return role === "admin";
}
