/**
 * AuthRepository — 认证相关数据库查询
 *
 * 提供 API 密钥（VerificationToken）、团队、用户、组织等实体的查找方法。
 * 使用 Drizzle ORM 的 eq() 条件查询，返回 first() 结果或 null。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";

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
	async findVerificationTokenByHash(tokenHash: string) {
		const rows = await this._db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenHash)).limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 根据团队 ID 查找团队
	 * @param teamId - 团队 UUID
	 * @returns 团队记录或 null
	 */
	async findTeamById(teamId: string) {
		const rows = await this._db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 根据用户 ID 查找用户
	 * @param userId - 用户 ID
	 * @returns 用户记录或 null
	 */
	async findUserById(userId: string) {
		const rows = await this._db.select().from(LiteLLM_UserTable).where(eq(LiteLLM_UserTable.userId, userId)).limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 根据组织 ID 查找组织
	 * @param orgId - 组织 UUID
	 * @returns 组织记录或 null
	 */
	async findOrganizationById(orgId: string) {
		const rows = await this._db
			.select()
			.from(LiteLLM_OrganizationTable)
			.where(eq(LiteLLM_OrganizationTable.organizationId, orgId))
			.limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 根据端用户 ID 查找端用户
	 * @param userId - 端用户 ID
	 * @returns 端用户记录或 null
	 */
	async findEndUserById(userId: string) {
		const rows = await this._db.select().from(LiteLLM_EndUserTable).where(eq(LiteLLM_EndUserTable.userId, userId)).limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 根据预算 ID 查找预算记录
	 * @param budgetId - 预算 UUID
	 * @returns 预算记录或 null
	 */
	async findBudgetById(budgetId: string) {
		const rows = await this._db.select().from(LiteLLM_BudgetTable).where(eq(LiteLLM_BudgetTable.budget_id, budgetId)).limit(1);
		return rows.at(0) ?? null;
	}
}
