/**
 * AuthRepository — 认证链读取实体的门面。
 *
 * 鉴权每请求要串行读同一批实体（token、团队、用户、组织、端用户、预算、团队成员、
 * 项目），因此这些读方法全部走按键缓存：缓存实例是 `AuthRepositoryCache` 里的
 * `authRepositoryCache` 单例，键与标签由 `authCacheKey`/`authCacheTag` 统一构造。
 * 记账提交后的 `invalidateAuthCacheForSpendSubjects` 清的就是这个实例，所以结算后的
 * spend 不会被另一份副本盖回旧值。
 *
 * 具体 SQL 与写路径（写穿/失效）由各表仓储拥有：本类只保留鉴权侧需要的公共方法签名，
 * 便于调用方不感知仓储拆分；表符号在本文件中不再出现。
 */

import type { DrizzleDb } from "../core/db/Database";
import { keyRepositoryFor, type DeprecatedKeyRow, type KeyRow } from "../repositories/KeyRepository";
import { userRepositoryFor, type UserRow } from "../repositories/UserRepository";
import { teamRepositoryFor, type TeamMembershipRow, type TeamRow } from "../repositories/TeamRepository";
import { organizationRepositoryFor, type OrganizationRow } from "../repositories/OrganizationRepository";
import { endUserRepositoryFor, type EndUserRow } from "../repositories/EndUserRepository";
import { budgetRepositoryFor, type BudgetRow } from "../repositories/BudgetRepository";
import { projectRepositoryFor, type ProjectRow } from "../repositories/ProjectRepository";

/**
 * AuthRepository
 *
 * 认证实体读取门面；缓存语义（按键缓存、TTL、提前刷新、失效）由表仓储内的
 * `authRepositoryCache` 调用保证。
 */
export class AuthRepository {
	constructor(private readonly _db: DrizzleDb) {}

	/**
	 * 根据令牌哈希查找验证令牌（API 密钥）
	 * @param tokenHash - SHA-256 哈希后的 API 密钥
	 * @returns 验证令牌记录或 null
	 */
	async findVerificationTokenByHash(tokenHash: string): Promise<KeyRow | null> {
		return await keyRepositoryFor(this._db).findByToken(tokenHash);
	}

	/**
	 * 注销 WebUI session。幂等地将对应 DB 记录标记为 blocked。
	 * @param tokenHash - SHA-256 哈希后的会话 token
	 */
	async revokeVerificationTokenByHash(tokenHash: string): Promise<void> {
		await keyRepositoryFor(this._db).updateByToken(tokenHash, { blocked: true });
	}

	/**
	 * 延长 WebUI session 的服务端过期时间。不改变 blocked 状态，因此与并发注销兼容。
	 * @param tokenHash - SHA-256 哈希后的会话 token
	 * @param expiresAt - 新的过期时刻
	 */
	async extendVerificationTokenExpiry(tokenHash: string, expiresAt: Date): Promise<void> {
		await keyRepositoryFor(this._db).updateByToken(tokenHash, { expires: expiresAt, updatedAt: new Date() });
	}

	/**
	 * 根据旧令牌哈希查找轮换后的 deprecated token 记录
	 * @param tokenHash - SHA-256 哈希后的旧 API 密钥
	 * @returns deprecated token 记录或 null
	 */
	async findDeprecatedVerificationTokenByHash(tokenHash: string): Promise<DeprecatedKeyRow | null> {
		return await keyRepositoryFor(this._db).findDeprecatedByToken(tokenHash);
	}

	/**
	 * 根据团队 ID 查找团队
	 * @param teamId - 团队 UUID
	 * @returns 团队记录或 null
	 */
	async findTeamById(teamId: string): Promise<TeamRow | null> {
		return await teamRepositoryFor(this._db).findById(teamId);
	}

	/**
	 * 根据用户 ID 查找用户
	 * @param userId - 用户 ID
	 * @returns 用户记录或 null
	 */
	async findUserById(userId: string): Promise<UserRow | null> {
		return await userRepositoryFor(this._db).findById(userId);
	}

	/**
	 * 根据组织 ID 查找组织
	 * @param orgId - 组织 UUID
	 * @returns 组织记录或 null
	 */
	async findOrganizationById(orgId: string): Promise<OrganizationRow | null> {
		return await organizationRepositoryFor(this._db).findById(orgId);
	}

	/**
	 * 根据端用户 ID 查找端用户
	 * @param userId - 端用户 ID
	 * @returns 端用户记录或 null
	 */
	async findEndUserById(userId: string): Promise<EndUserRow | null> {
		return await endUserRepositoryFor(this._db).findById(userId);
	}

	/**
	 * 根据预算 ID 查找预算记录
	 * @param budgetId - 预算 UUID
	 * @returns 预算记录或 null
	 */
	async findBudgetById(budgetId: string): Promise<BudgetRow | null> {
		return await budgetRepositoryFor(this._db).findById(budgetId);
	}

	/**
	 * 根据用户和团队复合键读取团队成员账务主体。
	 * @param userId - 用户 ID
	 * @param teamId - 团队 ID
	 * @returns 团队成员关系或 null
	 */
	async findTeamMembership(userId: string, teamId: string): Promise<TeamMembershipRow | null> {
		return await teamRepositoryFor(this._db).findMembership(userId, teamId);
	}

	/**
	 * 根据项目 ID 读取项目账务主体。
	 * @param projectId - 项目 ID
	 * @returns 项目记录或 null
	 */
	async findProjectById(projectId: string): Promise<ProjectRow | null> {
		return await projectRepositoryFor(this._db).findById(projectId);
	}
}
