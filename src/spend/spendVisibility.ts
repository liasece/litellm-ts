/**
 * Spend 日志的认证可见性边界。
 *
 * Logs 列表、Session 计数与详情、Session 时间线及其实时流都是同一份日志数据的读取入口，
 * 必须给出相同的裁剪结果。把管理员判定与可见性条件集中在这里，新入口复用同一实现，
 * 不再各自复制一份条件，也就不会因为某处漏改而让低权限用户读到别人的日志。
 */

import { eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { ApiError } from "../core/api/ApiError";
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
 */
export async function resolveSpendVisibilityClause(
	db: NodePgDatabase<typeof schema>,
	auth: UserAPIKeyAuth | undefined,
	requestedTeamId?: string,
): Promise<SQL> {
	if (isSpendAdminView(auth)) {
		return requestedTeamId === undefined ? sql`TRUE` : eq(liteLLM_SpendLogs.team_id, requestedTeamId);
	}
	if (requestedTeamId !== undefined) {
		if (!(await canTeamMemberViewLog(db, auth, requestedTeamId))) {
			throw new ApiError(HTTP_FORBIDDEN, "Not authorized to view requested team spend");
		}
		return eq(liteLLM_SpendLogs.team_id, requestedTeamId);
	}
	if (isInternalUserRole(auth) && auth?.user_id) {
		return eq(liteLLM_SpendLogs.user, auth.user_id);
	}
	if (auth?.team_id) {
		return eq(liteLLM_SpendLogs.team_id, auth.team_id);
	}
	if (auth?.user_id) {
		return eq(liteLLM_SpendLogs.user, auth.user_id);
	}
	return sql`FALSE`;
}

/**
 * ActiveRequests 使用与 SpendLogs 相同的可见性决策。requestedTeamId 的成员校验已由
 * resolveSpendVisibilityClause 完成，此处只把同一决策映射到活跃表列。
 * @param auth - 请求认证信息
 * @param requestedTeamId - 调用方显式指定的 team
 */
export function resolveActiveRequestVisibilityClause(auth: UserAPIKeyAuth | undefined, requestedTeamId?: string): SQL {
	if (isSpendAdminView(auth)) {
		return requestedTeamId === undefined ? sql`TRUE` : eq(liteLLM_ActiveRequests.team_id, requestedTeamId);
	}
	if (requestedTeamId !== undefined) {
		return eq(liteLLM_ActiveRequests.team_id, requestedTeamId);
	}
	if (isInternalUserRole(auth) && auth?.user_id) {
		return eq(liteLLM_ActiveRequests.user, auth.user_id);
	}
	if (auth?.team_id) {
		return eq(liteLLM_ActiveRequests.team_id, auth.team_id);
	}
	if (auth?.user_id) {
		return eq(liteLLM_ActiveRequests.user, auth.user_id);
	}
	return sql`FALSE`;
}

/**
 * Python `_can_team_member_view_log`：team 存在且用户在 team admins 列表中。
 * @param db - 数据库实例
 * @param auth - 请求认证信息
 * @param teamId - 待检查的 team
 */
async function canTeamMemberViewLog(
	db: NodePgDatabase<typeof schema>,
	auth: UserAPIKeyAuth | undefined,
	teamId: string,
): Promise<boolean> {
	if (!auth || !auth.user_id) {
		return false;
	}
	const rows = await db
		.select({
			admins: LiteLLM_TeamTable.admins,
			membersWithRoles: LiteLLM_TeamTable.membersWithRoles,
		})
		.from(LiteLLM_TeamTable)
		.where(eq(LiteLLM_TeamTable.teamId, teamId))
		.limit(1);
	const team = rows.at(0);
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
