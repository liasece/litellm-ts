/**
 * 结算时的跨主体 spend 累加 — 一次数据库往返改完所有账务主体。
 *
 * 每个请求结算都要给 key / user / team / organization / project / team_member / end_user
 * 各自累加同一笔 spend、刷新 key 活跃时间。这些更新互不依赖，但都属于同一个结算事务；
 * 拆成多条 UPDATE 会把「主体条数 × 往返」重新叠加到结算延迟与行锁持有时间上，
 * 因此保持一条 `WITH ... SELECT 1` 语句：PostgreSQL 在一个语句里完成全部 CTE 更新，
 * 客户端只等一次往返。
 *
 * SQL 语义与迁移前逐字一致：`nothing` 主体不存在时对应 CTE 只更新 0 行，不抛错；
 * `SET` 左侧必须是裸列名，PostgreSQL 不接受 `SET "表"."列"` 的限定写法。
 */

import { sql, type SQL } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_ProjectTable } from "../db/schema/projects";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { singletonFor } from "./internal/registry";

/** 事务句柄；结算事务由调用方开启，本仓库不自行提交。 */
export type SpendSettlementTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** 一次结算要累加的全部主体。 */
export interface SpendSettlementSubjects {
	/** 认证 token（已按 master key 策略转换后的落库值）。 */
	readonly token: string;
	/** 本次实际费用。 */
	readonly spend: number;
	/** 用户 ID；缺省时跳过用户与成员关系累加。 */
	readonly userId?: string | null;
	/** 团队 ID；缺省时跳过团队与成员关系累加。 */
	readonly teamId?: string | null;
	/** 组织 ID；缺省时跳过组织累加。 */
	readonly organizationId?: string | null;
	/** 项目 ID；缺省时跳过项目累加。 */
	readonly projectId?: string | null;
	/** 终端用户 ID；缺省时跳过终端用户累加。 */
	readonly endUserId?: string | null;
}

/**
 * 取得与数据库连接绑定的结算累加仓库。
 * @param db - Drizzle 数据库实例
 */
export const spendSettlementRepositoryFor = singletonFor((db: DrizzleDb) => new SpendSettlementRepository(db));

/** `LiteLLM_VerificationToken` 等账务主体的单语句累加器。 */
export class SpendSettlementRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 在调用方事务内累计全部主体的 spend 并刷新 key 活跃时间。
	 *
	 * 单条语句、单次往返；任何主体不存在时只是对应 CTE 不更新行，不影响其他主体
	 * 已完成的累加（与迁移前一致）。
	 * @param tx - 结算事务句柄
	 * @param subjects - 本次结算的账务主体
	 */
	async accumulateSubjectSpend(tx: SpendSettlementTransaction, subjects: SpendSettlementSubjects): Promise<void> {
		const now = new Date();
		const updates: SQL[] = [
			sql`token_spend AS (
				UPDATE ${LiteLLM_VerificationToken}
				SET spend = COALESCE(${LiteLLM_VerificationToken.spend}, 0) + ${subjects.spend},
					last_active = ${now}
				WHERE ${LiteLLM_VerificationToken.token} = ${subjects.token}
				RETURNING 1
			)`,
		];
		if (subjects.userId) {
			updates.push(sql`user_spend AS (
				UPDATE ${LiteLLM_UserTable}
				SET spend = COALESCE(${LiteLLM_UserTable.spend}, 0) + ${subjects.spend}
				WHERE ${LiteLLM_UserTable.userId} = ${subjects.userId}
				RETURNING 1
			)`);
		}
		if (subjects.teamId) {
			updates.push(sql`team_spend AS (
				UPDATE ${LiteLLM_TeamTable}
				SET spend = COALESCE(${LiteLLM_TeamTable.spend}, 0) + ${subjects.spend}
				WHERE ${LiteLLM_TeamTable.teamId} = ${subjects.teamId}
				RETURNING 1
			)`);
		}
		if (subjects.organizationId) {
			updates.push(sql`organization_spend AS (
				UPDATE ${LiteLLM_OrganizationTable}
				SET spend = COALESCE(${LiteLLM_OrganizationTable.spend}, 0) + ${subjects.spend}
				WHERE ${LiteLLM_OrganizationTable.organizationId} = ${subjects.organizationId}
				RETURNING 1
			)`);
		}
		if (subjects.projectId) {
			updates.push(sql`project_spend AS (
				UPDATE ${LiteLLM_ProjectTable}
				SET spend = COALESCE(${LiteLLM_ProjectTable.spend}, 0) + ${subjects.spend}
				WHERE ${LiteLLM_ProjectTable.projectId} = ${subjects.projectId}
				RETURNING 1
			)`);
		}
		if (subjects.userId && subjects.teamId) {
			updates.push(sql`membership_spend AS (
				UPDATE ${LiteLLM_TeamMembership}
				SET spend = COALESCE(${LiteLLM_TeamMembership.spend}, 0) + ${subjects.spend}
				WHERE ${LiteLLM_TeamMembership.userId} = ${subjects.userId} AND ${LiteLLM_TeamMembership.teamId} = ${subjects.teamId}
				RETURNING 1
			)`);
		}
		if (subjects.endUserId) {
			updates.push(sql`end_user_spend AS (
				UPDATE ${LiteLLM_EndUserTable}
				SET spend = COALESCE(${LiteLLM_EndUserTable.spend}, 0) + ${subjects.spend}
				WHERE ${LiteLLM_EndUserTable.userId} = ${subjects.endUserId}
				RETURNING 1
			)`);
		}
		await tx.execute(sql`WITH ${sql.join(updates, sql`, `)} SELECT 1`);
	}
}
