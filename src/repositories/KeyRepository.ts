/**
 * 密钥仓储 — `LiteLLM_VerificationToken`、弃用密钥表与已删除密钥表的唯一访问点。
 *
 * 密钥行随租户增长，不能像配置表那样整表复制，因此按键缓存：读走 `authRepositoryCache`
 * 里已有的 `authCacheKey.verificationToken` 条目，键与标签沿用鉴权链的约定，管理端、
 * 鉴权链与 WebUI 会话校验共享同一份行副本。
 *
 * 写入成功后写穿或删掉对应键，并调用 `AuthRepositoryCache` 的失效函数：记账提交
 * （`invalidateAuthCacheForSpendSubjects`）与管理端写（`invalidateAuthCacheForTokenHash`）
 * 操作的是同一个缓存实例，因此不存在「结算后内存里还留着旧 spend」的第二份副本。
 *
 * 事务内的写入只做失效、不做写穿：提交前写穿会暴露未提交值，回滚后还会留下脏读；
 * 失效在回滚时天然安全，下一次读回落到数据库即可。
 *
 * 弃用密钥与已删除密钥是轮换/删除的附属表，读取直接查库（鉴权侧弃用记录另有缓存键）。
 */

import { and, eq, ilike, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { liteLLM_DeletedVerificationToken } from "../db/schema/deleted-verification-tokens";
import { liteLLM_DeprecatedVerificationToken } from "../db/schema/deprecated-tokens";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import {
	authCacheKey,
	authCacheTag,
	authRepositoryCache,
	invalidateAuthCacheForSubject,
	invalidateAuthCacheForTokenHash,
} from "../auth/AuthRepositoryCache";
import { WEBUI_LOGIN_TEAM_ID } from "../types/webUiSession";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_VerificationToken` 行。 */
export type KeyRow = typeof LiteLLM_VerificationToken.$inferSelect;
/** 新建密钥行时可写入的列。 */
export type KeyInsertValues = typeof LiteLLM_VerificationToken.$inferInsert;
/** 更新密钥行时可修改的列（缺省列不参与 UPDATE）。 */
export type KeyUpdateValues = Partial<typeof LiteLLM_VerificationToken.$inferInsert>;
/** `LiteLLM_DeprecatedVerificationToken` 行。 */
export type DeprecatedKeyRow = typeof liteLLM_DeprecatedVerificationToken.$inferSelect;
/** 新建弃用密钥行时可写入的列。 */
export type DeprecatedKeyInsertValues = typeof liteLLM_DeprecatedVerificationToken.$inferInsert;
/** `LiteLLM_DeletedVerificationToken` 行。 */
export type DeletedKeyRow = typeof liteLLM_DeletedVerificationToken.$inferSelect;
/** 事务句柄；跨仓储写入时由调用方传入，本仓储不自行开启事务。 */
export type KeyTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** `/key/list` 的过滤条件（对齐 Python list_keys 的 query 语义）。 */
export interface KeyListFilters {
	/** 只保留该用户名的 key。 */
	readonly userId?: string;
	/** 只保留该团队的 key。 */
	readonly teamId?: string;
	/** 只保留该组织的 key。 */
	readonly organizationId?: string;
	/** 精确匹配的 token（已 hash）。 */
	readonly keyHash?: string;
	/** key_alias 的大小写不敏感子串。 */
	readonly keyAlias?: string;
	/** 只保留该项目的 key。 */
	readonly projectId?: string;
	/** 只保留白名单里含该访问组的 key。 */
	readonly accessGroupId?: string;
	/** 过期状态过滤。 */
	readonly expires?: "expired" | "not_expired";
	/** 状态过滤；`deleted` 只对已删除密钥表有意义。 */
	readonly status?: "active" | "blocked" | "revoked" | "expired" | "deleted";
}

/** `/key/aliases` 的过滤条件。 */
export interface KeyAliasFilters {
	/** key_alias 的大小写不敏感子串。 */
	readonly search?: string;
	/** 只保留该团队的 key。 */
	readonly teamId?: string;
}

/** 删除密钥时写进审计表的删除元信息（请求上下文，不属于密钥行本身）。 */
export interface KeyDeletionMetadata {
	/** 删除时刻。 */
	readonly deletedAt: Date;
	/** 发起删除的用户。 */
	readonly deletedBy: string | null;
	/** 发起删除的会话 token。 */
	readonly deletedByApiKey: string | null;
	/** 请求头 `litellm-changed-by` 的审计值。 */
	readonly litellmChangedBy: string | null;
}

/**
 * token 行的失效标签。
 *
 * 与鉴权链同构（user/team），删号或删团队时按标签一次清掉该主体名下的全部 key 行；
 * 只按 token 主键失效会漏掉「用户行被删、token 行还在缓存里」的窗口。
 * @param row - 密钥行
 */
function tokenTags(row: KeyRow): readonly string[] {
	const tags: string[] = [];
	if (row.userId) {
		tags.push(authCacheTag.user(row.userId));
	}
	if (row.teamId) {
		tags.push(authCacheTag.team(row.teamId));
	}
	return tags;
}

/**
 * 取得与数据库连接绑定的密钥仓库；缓存本身是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const keyRepositoryFor = singletonFor((db: DrizzleDb) => new KeyRepository(db));

/** 三张密钥表的读写实现。 */
export class KeyRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按 token（已 hash）读取密钥行；命中缓存时不再查库。
	 * @param token - LiteLLM_VerificationToken.token
	 * @returns 密钥行或 null（负结果不缓存）
	 */
	async findByToken(token: string): Promise<KeyRow | null> {
		return await authRepositoryCache.load<KeyRow>(
			authCacheKey.verificationToken(token),
			async () => {
				const rows = await this._db
					.select()
					.from(LiteLLM_VerificationToken)
					.where(eq(LiteLLM_VerificationToken.token, token))
					.limit(1);
				return rows.at(0) ?? null;
			},
			tokenTags,
		);
	}

	/**
	 * 判断 token 是否已存在；WebUI 会话签发时用于规避极低概率的 hash 碰撞。
	 * @param token - 待检查的 token（已 hash）
	 * @returns 存在返回 true
	 */
	async hasToken(token: string): Promise<boolean> {
		const rows = await this._db
			.select({ token: LiteLLM_VerificationToken.token })
			.from(LiteLLM_VerificationToken)
			.where(eq(LiteLLM_VerificationToken.token, token))
			.limit(1);
		return rows.length > 0;
	}

	/**
	 * 按旧 token 读取轮换记录。
	 * @param token - 旧 token（已 hash）
	 * @returns 弃用记录或 null
	 */
	async findDeprecatedByToken(token: string): Promise<DeprecatedKeyRow | null> {
		return await authRepositoryCache.load<DeprecatedKeyRow>(authCacheKey.deprecatedToken(token), async () => {
			const rows = await this._db
				.select()
				.from(liteLLM_DeprecatedVerificationToken)
				.where(eq(liteLLM_DeprecatedVerificationToken.token, token))
				.limit(1);
			return rows.at(0) ?? null;
		});
	}

	/**
	 * 按 key_alias 精确查找；/key/update 用它把别名解析成唯一 token。
	 * @param keyAlias - key_alias 列
	 * @returns 最多两个匹配行（大于一个即说明别名不唯一）
	 */
	async findByAliasExactly(keyAlias: string): Promise<KeyRow[]> {
		return await this._db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.keyAlias, keyAlias)).limit(2);
	}

	/**
	 * 读取指定用户的全部密钥行。
	 * @param userId - LiteLLM_VerificationToken.user_id
	 */
	async listByUserId(userId: string): Promise<KeyRow[]> {
		return await this._db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.userId, userId));
	}

	/**
	 * 读取指定用户的有效密钥行：排除 WebUI 登录会话临时 key。
	 * @param userId - LiteLLM_VerificationToken.user_id
	 */
	async listActiveByUserId(userId: string): Promise<KeyRow[]> {
		return await this._db
			.select()
			.from(LiteLLM_VerificationToken)
			.where(
				and(
					eq(LiteLLM_VerificationToken.userId, userId),
					or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID)),
				),
			);
	}

	/**
	 * 读取指定团队的密钥行。
	 * @param teamId - LiteLLM_VerificationToken.team_id
	 */
	async listByTeamId(teamId: string): Promise<KeyRow[]> {
		return await this._db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.teamId, teamId));
	}

	/** 读取全部密钥行；仅供需要内存 join 的列表端点使用。 */
	async listAll(): Promise<KeyRow[]> {
		return await this._db.select().from(LiteLLM_VerificationToken);
	}

	/**
	 * 按 token 批量读取。
	 * @param tokens - 已 hash 的 token 列表
	 */
	async listByTokens(tokens: readonly string[]): Promise<KeyRow[]> {
		return await this._db
			.select()
			.from(LiteLLM_VerificationToken)
			.where(inArray(LiteLLM_VerificationToken.token, [...tokens]));
	}

	/**
	 * 按 key_alias 批量读取。
	 * @param aliases - 别名列表
	 */
	async listByAliases(aliases: readonly string[]): Promise<KeyRow[]> {
		return await this._db
			.select()
			.from(LiteLLM_VerificationToken)
			.where(inArray(LiteLLM_VerificationToken.keyAlias, [...aliases]));
	}

	/**
	 * 读取密钥模型白名单投影（模型改名级联用，不需要整行）。
	 * @returns token 与 models 两列
	 */
	async listModelWhitelists(): Promise<Array<{ readonly token: string; readonly models: readonly string[] | null }>> {
		return await this._db
			.select({ token: LiteLLM_VerificationToken.token, models: LiteLLM_VerificationToken.models })
			.from(LiteLLM_VerificationToken);
	}

	/**
	 * `/key/list` 的在用密钥查询；过滤条件在数据库侧完成，内存只做二次校验。
	 * @param filters - 过滤条件
	 */
	async listForList(filters: KeyListFilters): Promise<KeyRow[]> {
		return await this._db.select().from(LiteLLM_VerificationToken).where(buildKeyListWhere(filters));
	}

	/**
	 * `/key/list?status=deleted` 的已删除密钥查询。
	 * @param filters - 过滤条件
	 */
	async listDeletedForList(filters: KeyListFilters): Promise<DeletedKeyRow[]> {
		return await this._db.select().from(liteLLM_DeletedVerificationToken).where(buildDeletedKeyListWhere(filters));
	}

	/**
	 * `/key/aliases` 的候选行查询。
	 * @param filters - 过滤条件
	 */
	async listAliasCandidates(filters: KeyAliasFilters): Promise<KeyRow[]> {
		return await this._db.select().from(LiteLLM_VerificationToken).where(buildKeyAliasesWhere(filters));
	}

	/**
	 * 事务内按 token 批量读取（删除前先取到待归档的完整行）。
	 * @param tx - 事务句柄
	 * @param tokens - 已 hash 的 token 列表
	 */
	async listByTokensInTx(tx: KeyTransaction, tokens: readonly string[]): Promise<KeyRow[]> {
		return await tx
			.select()
			.from(LiteLLM_VerificationToken)
			.where(inArray(LiteLLM_VerificationToken.token, [...tokens]));
	}

	/**
	 * 事务内按 key_alias 批量读取。
	 * @param tx - 事务句柄
	 * @param aliases - 别名列表
	 */
	async listByAliasesInTx(tx: KeyTransaction, aliases: readonly string[]): Promise<KeyRow[]> {
		return await tx
			.select()
			.from(LiteLLM_VerificationToken)
			.where(inArray(LiteLLM_VerificationToken.keyAlias, [...aliases]));
	}

	/**
	 * 事务内按 token 读取单行。
	 * @param tx - 事务句柄
	 * @param token - 已 hash 的 token
	 */
	async findByTokenInTx(tx: KeyTransaction, token: string): Promise<KeyRow | null> {
		const rows = await tx.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, token)).limit(1);
		return rows.at(0) ?? null;
	}

	/**
	 * 新建密钥行。
	 *
	 * 不回读整行（插入语句本身不带 `returning`，避免为一个刚生成的 hash 再查一次库）；
	 * 缓存只做失效，随后第一次鉴权读到的是数据库里的权威行。
	 * @param values - 可写入列
	 */
	async create(values: KeyInsertValues): Promise<void> {
		await this._db.insert(LiteLLM_VerificationToken).values(values);
		this.invalidateToken(values.token);
	}

	/**
	 * 按 token 更新密钥行；成功后同时失效按键缓存与鉴权缓存（同一个实例）。
	 * @param token - 目标行 token
	 * @param values - 待更新列（调用方负责 updatedAt 等时间字段语义）
	 * @returns 受影响行数
	 */
	async updateByToken(token: string, values: KeyUpdateValues): Promise<number> {
		// 少数驱动适配层/测试桩只 resolve 空值，不保证带 rowCount；缺省按 0 处理，
		// 调用方另用自己的存在性检查兜底。
		const result = (await this._db.update(LiteLLM_VerificationToken).set(values).where(eq(LiteLLM_VerificationToken.token, token))) as
			| { readonly rowCount?: number | null }
			| undefined;
		this.invalidateToken(token);
		return result?.rowCount ?? 0;
	}

	/**
	 * 事务内轮换 token：把旧行的 token 改成新 hash 并写入轮换元信息。
	 * @param tx - 事务句柄
	 * @param oldToken - 轮换前的 token
	 * @param values - 除主键外的更新列
	 */
	async rotateInTx(tx: KeyTransaction, oldToken: string, values: KeyUpdateValues): Promise<void> {
		await tx.update(LiteLLM_VerificationToken).set(values).where(eq(LiteLLM_VerificationToken.token, oldToken));
		this.invalidateToken(oldToken);
		if (typeof values.token === "string") {
			this.invalidateToken(values.token);
		}
	}

	/**
	 * 事务内写入弃用密钥记录。
	 * @param tx - 事务句柄
	 * @param values - 可写入列
	 */
	async insertDeprecatedInTx(tx: KeyTransaction, values: DeprecatedKeyInsertValues): Promise<void> {
		await tx.insert(liteLLM_DeprecatedVerificationToken).values(values);
	}

	/**
	 * 事务内把待删除的密钥行归档到审计表。
	 * @param tx - 事务句柄
	 * @param rows - 待归档的完整密钥行
	 * @param metadata - 删除请求上下文
	 */
	async archiveDeletedInTx(tx: KeyTransaction, rows: readonly KeyRow[], metadata: KeyDeletionMetadata): Promise<void> {
		await tx.insert(liteLLM_DeletedVerificationToken).values(
			rows.map((row) => ({
				...row,
				deletedAt: metadata.deletedAt,
				deletedBy: metadata.deletedBy,
				deletedByApiKey: metadata.deletedByApiKey,
				litellmChangedBy: metadata.litellmChangedBy,
			})),
		);
	}

	/**
	 * 事务内删除指定 token，并按主体清掉缓存。
	 * @param tx - 事务句柄
	 * @param rows - 已确认要删除的行（提供 user/team 标签依据）
	 */
	async deleteByTokensInTx(tx: KeyTransaction, rows: readonly KeyRow[]): Promise<void> {
		await tx.delete(LiteLLM_VerificationToken).where(
			inArray(
				LiteLLM_VerificationToken.token,
				rows.map((row) => row.token),
			),
		);
		for (const row of rows) {
			this.invalidateToken(row.token);
			if (row.userId) {
				invalidateAuthCacheForSubject({ userId: row.userId });
			}
			if (row.teamId) {
				invalidateAuthCacheForSubject({ teamId: row.teamId });
			}
		}
	}

	/**
	 * 删除团队名下全部密钥（团队级联删除）。
	 * @param teamIds - 团队 ID 列表
	 */
	async deleteByTeamIds(teamIds: readonly string[]): Promise<void> {
		await this._db.delete(LiteLLM_VerificationToken).where(inArray(LiteLLM_VerificationToken.teamId, [...teamIds]));
		for (const teamId of teamIds) {
			invalidateAuthCacheForSubject({ teamId: teamId });
		}
	}

	/**
	 * 删除用户名下全部密钥（用户级联删除）。
	 * @param userIds - 用户 ID 列表
	 */
	async deleteByUserIds(userIds: readonly string[]): Promise<void> {
		await this._db.delete(LiteLLM_VerificationToken).where(inArray(LiteLLM_VerificationToken.userId, [...userIds]));
		for (const userId of userIds) {
			invalidateAuthCacheForSubject({ userId: userId });
		}
	}

	/**
	 * 失效某个 token 的缓存。
	 * @param token - 已 hash 的 token
	 */
	invalidateToken(token: string): void {
		invalidateAuthCacheForTokenHash(token);
	}
}

/**
 * `/key/list` 的 where 条件；排除 WebUI 登录会话 team 的临时 key。
 * @param filters - 过滤条件
 */
function buildKeyListWhere(filters: KeyListFilters): ReturnType<typeof and> {
	const conditions = [or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID))];
	if (filters.userId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.userId, filters.userId));
	}
	if (filters.teamId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.teamId, filters.teamId));
	}
	if (filters.organizationId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.organizationId, filters.organizationId));
	}
	if (filters.keyHash !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.token, filters.keyHash));
	}
	if (filters.keyAlias !== undefined) {
		conditions.push(ilike(LiteLLM_VerificationToken.keyAlias, `%${filters.keyAlias.replace(/[\\%_]/g, "\\$&")}%`));
	}
	if (filters.projectId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.projectId, filters.projectId));
	}
	if (filters.status === "blocked" || filters.status === "revoked") {
		conditions.push(eq(LiteLLM_VerificationToken.blocked, true));
	}
	if (filters.status === "active") {
		conditions.push(or(isNull(LiteLLM_VerificationToken.blocked), eq(LiteLLM_VerificationToken.blocked, false)));
	}
	return and(...conditions);
}

/**
 * 已删除密钥表的 where 条件。
 * @param filters - 过滤条件
 */
function buildDeletedKeyListWhere(filters: KeyListFilters): ReturnType<typeof and> {
	const conditions = [
		or(isNull(liteLLM_DeletedVerificationToken.teamId), ne(liteLLM_DeletedVerificationToken.teamId, WEBUI_LOGIN_TEAM_ID)),
	];
	if (filters.userId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.userId, filters.userId));
	}
	if (filters.teamId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.teamId, filters.teamId));
	}
	if (filters.organizationId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.organizationId, filters.organizationId));
	}
	if (filters.keyHash !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.token, filters.keyHash));
	}
	if (filters.keyAlias !== undefined) {
		conditions.push(ilike(liteLLM_DeletedVerificationToken.keyAlias, `%${filters.keyAlias.replace(/[\\%_]/g, "\\$&")}%`));
	}
	if (filters.projectId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.projectId, filters.projectId));
	}
	return and(...conditions);
}

/**
 * `/key/aliases` 的 where 条件：排除空别名与 WebUI 登录会话 key。
 * @param filters - 过滤条件
 */
function buildKeyAliasesWhere(filters: KeyAliasFilters): ReturnType<typeof and> {
	const conditions = [
		isNotNull(LiteLLM_VerificationToken.keyAlias),
		ne(LiteLLM_VerificationToken.keyAlias, ""),
		or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID)),
	];
	if (filters.search !== undefined) {
		conditions.push(ilike(LiteLLM_VerificationToken.keyAlias, `%${filters.search}%`));
	}
	if (filters.teamId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.teamId, filters.teamId));
	}
	return and(...conditions);
}
