/**
 * AuthRepository — 认证相关数据库查询
 *
 * 提供 API 密钥（VerificationToken）、团队、用户、组织等实体的查找方法。
 * 使用 Drizzle ORM 的 eq() 条件查询，返回 first() 结果或 null。
 *
 * 读路径全部经过进程级缓存（见 AuthRepositoryCache）：鉴权链每请求会串行读同一批
 * 实体，缓存命中即可省掉这部分往返。写方法与记账提交都会主动失效，不依赖 TTL 生效。
 */

import { and, eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";
import { liteLLM_DeprecatedVerificationToken } from "../db/schema/deprecated-tokens";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { LiteLLM_ProjectTable } from "../db/schema/projects";
import { authCacheKey, authCacheTag, authRepositoryCache } from "./AuthRepositoryCache";

type VerificationTokenRow = typeof LiteLLM_VerificationToken.$inferSelect;
type DeprecatedVerificationTokenRow = typeof liteLLM_DeprecatedVerificationToken.$inferSelect;
type TeamRow = typeof LiteLLM_TeamTable.$inferSelect;
type UserRow = typeof LiteLLM_UserTable.$inferSelect;
type OrganizationRow = typeof LiteLLM_OrganizationTable.$inferSelect;
type EndUserRow = typeof LiteLLM_EndUserTable.$inferSelect;
type BudgetRow = typeof LiteLLM_BudgetTable.$inferSelect;
type TeamMembershipRow = typeof LiteLLM_TeamMembership.$inferSelect;
type ProjectRow = typeof LiteLLM_ProjectTable.$inferSelect;

/**
 * AuthRepository
 *
 * API 密钥、团队、用户、组织等认证实体的数据库查询实现。
 */
export class AuthRepository {
	constructor(private readonly _db: DrizzleDb) {}

	/**
	 * 根据令牌哈希查找验证令牌（API 密钥）
	 * @param tokenHash - SHA-256 哈希后的 API 密钥
	 * @returns 验证令牌记录或 null
	 */
	async findVerificationTokenByHash(tokenHash: string): Promise<VerificationTokenRow | null> {
		const key = authCacheKey.verificationToken(tokenHash);
		const cached = authRepositoryCache.get<VerificationTokenRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenHash)).limit(1);
		const row = rows.at(0) ?? null;
		if (row !== null) {
			const tags: string[] = [];
			if (row.userId) {
				tags.push(authCacheTag.user(row.userId));
			}
			if (row.teamId) {
				tags.push(authCacheTag.team(row.teamId));
			}
			authRepositoryCache.set(key, row, tags);
		}
		return row;
	}

	/**
	 * 注销 WebUI session。幂等地将对应 DB 记录标记为 blocked。
	 * @param tokenHash
	 */
	async revokeVerificationTokenByHash(tokenHash: string): Promise<void> {
		await this._db.update(LiteLLM_VerificationToken).set({ blocked: true }).where(eq(LiteLLM_VerificationToken.token, tokenHash));
		authRepositoryCache.delete(authCacheKey.verificationToken(tokenHash));
	}

	/**
	 * 延长 WebUI session 的服务端过期时间。不改变 blocked 状态，因此与并发注销兼容。
	 * @param tokenHash
	 * @param expiresAt
	 */
	async extendVerificationTokenExpiry(tokenHash: string, expiresAt: Date): Promise<void> {
		await this._db
			.update(LiteLLM_VerificationToken)
			.set({ expires: expiresAt, updatedAt: new Date() })
			.where(eq(LiteLLM_VerificationToken.token, tokenHash));
		authRepositoryCache.delete(authCacheKey.verificationToken(tokenHash));
	}

	/**
	 * 根据旧令牌哈希查找轮换后的 deprecated token 记录
	 * @param tokenHash - SHA-256 哈希后的旧 API 密钥
	 * @returns deprecated token 记录或 null
	 */
	async findDeprecatedVerificationTokenByHash(tokenHash: string): Promise<DeprecatedVerificationTokenRow | null> {
		const key = authCacheKey.deprecatedToken(tokenHash);
		const cached = authRepositoryCache.get<DeprecatedVerificationTokenRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db
			.select()
			.from(liteLLM_DeprecatedVerificationToken)
			.where(eq(liteLLM_DeprecatedVerificationToken.token, tokenHash))
			.limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row);
		return row;
	}

	/**
	 * 根据团队 ID 查找团队
	 * @param teamId - 团队 UUID
	 * @returns 团队记录或 null
	 */
	async findTeamById(teamId: string): Promise<TeamRow | null> {
		const key = authCacheKey.team(teamId);
		const cached = authRepositoryCache.get<TeamRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row, [authCacheTag.team(teamId)]);
		return row;
	}

	/**
	 * 根据用户 ID 查找用户
	 * @param userId - 用户 ID
	 * @returns 用户记录或 null
	 */
	async findUserById(userId: string): Promise<UserRow | null> {
		const key = authCacheKey.user(userId);
		const cached = authRepositoryCache.get<UserRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row, [authCacheTag.user(userId)]);
		return row;
	}

	/**
	 * 根据组织 ID 查找组织
	 * @param orgId - 组织 UUID
	 * @returns 组织记录或 null
	 */
	async findOrganizationById(orgId: string): Promise<OrganizationRow | null> {
		const key = authCacheKey.organization(orgId);
		const cached = authRepositoryCache.get<OrganizationRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db
			.select()
			.from(LiteLLM_OrganizationTable)
			.where(eq(LiteLLM_OrganizationTable.organizationId, orgId))
			.limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row);
		return row;
	}

	/**
	 * 根据端用户 ID 查找端用户
	 * @param userId - 端用户 ID
	 * @returns 端用户记录或 null
	 */
	async findEndUserById(userId: string): Promise<EndUserRow | null> {
		const key = authCacheKey.endUser(userId);
		const cached = authRepositoryCache.get<EndUserRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db.select().from(LiteLLM_EndUserTable).where(eq(LiteLLM_EndUserTable.userId, userId)).limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row);
		return row;
	}

	/**
	 * 根据预算 ID 查找预算记录
	 * @param budgetId - 预算 UUID
	 * @returns 预算记录或 null
	 */
	async findBudgetById(budgetId: string): Promise<BudgetRow | null> {
		const key = authCacheKey.budget(budgetId);
		const cached = authRepositoryCache.get<BudgetRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db.select().from(LiteLLM_BudgetTable).where(eq(LiteLLM_BudgetTable.budget_id, budgetId)).limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row);
		return row;
	}

	/**
	 * 根据用户和团队复合键读取团队成员账务主体。
	 * @param userId
	 * @param teamId
	 */
	async findTeamMembership(userId: string, teamId: string): Promise<TeamMembershipRow | null> {
		const key = authCacheKey.teamMembership(userId, teamId);
		const cached = authRepositoryCache.get<TeamMembershipRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db
			.select()
			.from(LiteLLM_TeamMembership)
			.where(and(eq(LiteLLM_TeamMembership.userId, userId), eq(LiteLLM_TeamMembership.teamId, teamId)))
			.limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row, [authCacheTag.user(userId), authCacheTag.team(teamId)]);
		return row;
	}

	/**
	 * 根据项目 ID 读取项目账务主体。
	 * @param projectId
	 */
	async findProjectById(projectId: string): Promise<ProjectRow | null> {
		const key = authCacheKey.project(projectId);
		const cached = authRepositoryCache.get<ProjectRow>(key);
		if (cached !== undefined) {
			return cached;
		}
		const rows = await this._db.select().from(LiteLLM_ProjectTable).where(eq(LiteLLM_ProjectTable.projectId, projectId)).limit(1);
		const row = rows.at(0) ?? null;
		authRepositoryCache.set(key, row);
		return row;
	}
}
