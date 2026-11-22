/**
 * WebUI 支撑端点的读模型 —— Usage 汇总、密钥元数据与账号身份查询。
 *
 * 这个仓储服务的是 WebUI 的「管理面」读取：Usage/Activity 页面按本地日历分桶聚合、
 * 展示密钥别名、上游账号身份，以及侧栏的用量指示器。它同时读两类数据：
 *   - 原始 `LiteLLM_SpendLogs`：带浏览器时区时唯一还能按当地日历切分的来源；
 *   - `LiteLLM_Daily*Spend` 日汇总表：原始日志覆盖之前的历史，以及不带时区的默认路径。
 *
 * 权限判断留在调用方：这里只接收已经算好的鉴权范围（某个实体的 ID，或某个 API Key），
 * 不判断谁是 admin。这样查询层不需要知道角色体系，鉴权改动也不会要求同时改 SQL。
 */

import { and, count, desc, eq, gte, inArray, lt, lte, min, notInArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { liteLLM_DeletedVerificationToken } from "../db/schema/deleted-verification-tokens";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { LiteLLM_SubscriptionAccount } from "../db/schema/subscriptionAccounts";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { localDayRangeUtc, nextCalendarDay, type DailyActivityTimezone } from "../spend/DailyActivityTimezone";
import { singletonFor } from "./internal/registry";

/**
 * 取得与数据库连接绑定的 WebUI 支撑仓储。
 * @param db - Drizzle 数据库实例
 */
export const webUiSupportRepositoryFor = singletonFor((db: DrizzleDb) => new WebUiSupportRepository(db));

/** Usage 维度的实体列名；决定聚合按哪个字段分组。 */
export type DailyActivityEntityField = "user_id" | "tag" | "team_id" | "organization_id" | "end_user_id" | "agent_id";

/**
 * 已算好的鉴权范围。
 *
 * `entityId` 表示「只看这个用户/团队/组织」（管理员之外的角色限制自己），`apiKey` 表示
 * 「只看这个 Key」；两者都没有时调用方已经拒绝请求，这里按「无条件限制」处理会读到全表，
 * 因此由调用方保证至少给出一项。
 */
export interface DailyActivityAuthScope {
	/** 受限实体 ID（按当前维度的实体列过滤）。 */
	readonly entityId?: string;
	/** 受限 API Key（按 api_key 列过滤）。 */
	readonly apiKey?: string;
}

/** Usage 查询共用的过滤条件（原始日志与日汇总表语义一致）。 */
export interface DailyActivityFilters {
	/** 起始本地日（含）。 */
	readonly startDate: string;
	/** 结束日；`endExclusive` 为真时不含当日。 */
	readonly endDate: string;
	/** 结束日是否开区间。 */
	readonly endExclusive: boolean;
	/** 已算好的鉴权范围。 */
	readonly authScope?: DailyActivityAuthScope;
	/** 按维度过滤的实体 ID 列表。 */
	readonly entityIds: readonly string[];
	/** 单实体过滤（详情页固定某个实体）。 */
	readonly singleEntityId?: string;
	/** 需要排除的实体 ID。 */
	readonly excludeEntityIds: readonly string[];
	/** 模型名过滤。 */
	readonly model?: string;
	/** API Key 过滤。 */
	readonly apiKeys: readonly string[];
	/** 密钥别名/名称搜索模式（已转义的 ILIKE pattern）。 */
	readonly keySearchPattern?: string;
}

/** 原始日志聚合的投影开关。 */
export interface DailyActivityLocalQueryOptions {
	/** 请求时区。 */
	readonly timezone: DailyActivityTimezone;
	/** 是否投影 endpoint 小列。 */
	readonly includeEndpoint: boolean;
	/** 是否 join 上游账号关联表并返回账号维度。 */
	readonly includeUpstreamAccount: boolean;
}

/** 日汇总表分页参数。 */
export interface DailyActivityPageOptions {
	/** 行数上限。 */
	readonly limit: number;
	/** 偏移；缺省表示从第一行开始，且不追加 OFFSET。 */
	readonly offset?: number;
}

/** 活跃密钥的元数据行。 */
export interface ActiveKeyMetadataRow {
	/** 密钥哈希 */
	readonly token: string;
	/** 展示用别名 */
	readonly keyAlias: string | null;
	/** 展示用名称 */
	readonly keyName: string | null;
	/** 归属团队 */
	readonly teamId: string | null;
}

/** 已删除密钥的元数据行（多带删除时间，用于取最近一条）。 */
export interface DeletedKeyMetadataRow extends ActiveKeyMetadataRow {
	/** 删除时间；同一 token 可能被删除后重建，取最近一条 */
	readonly deletedAt: Date | null;
}

/**
 * WebUI 支撑读取仓储。
 *
 * 只读；日汇总表与原始日志都由写入侧维护，这里不写、不缓存。
 */
export class WebUiSupportRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	// ────────────────────────── Usage 聚合 ──────────────────────────

	/**
	 * 用原始 SpendLogs 按调用方本地日历分桶。
	 *
	 * 日汇总表按 UTC 日期写入，无法把一天拆回另一个时区的当地日历；直接在带 startTime 索引
	 * 的原始日志上按「本地日期 + 维度」聚合，才能保证「今天」在本地凌晨、以及跨夏令时的
	 * 边界都包含正确区间。
	 * @param entityField - 当前 Usage 路由的实体维度
	 * @param filters - 过滤条件（本地日期以 startDate/endDate 表达）
	 * @param options - 时区与投影开关
	 * @returns 原始聚合行
	 */
	async listLocalDailyActivityRows(
		entityField: DailyActivityEntityField,
		filters: DailyActivityFilters,
		options: DailyActivityLocalQueryOptions,
	): Promise<Array<Record<string, unknown>>> {
		const result = (await this._db.execute(this._localDailyActivityQuery(entityField, filters, options))) as unknown as {
			readonly rows: ReadonlyArray<Record<string, unknown>>;
		};
		return [...result.rows];
	}

	/**
	 * 原始日志已覆盖的最早时间戳；没有原始日志时返回 null。
	 * @returns 最早 startTime
	 */
	async readRawCoverageFirstTimestamp(): Promise<Date | null> {
		const rows = await this._db.select({ first: min(liteLLM_SpendLogs.startTime) }).from(liteLLM_SpendLogs);
		return rows.at(0)?.first ?? null;
	}

	/**
	 * 读取原始日志覆盖之前的历史日汇总行。
	 *
	 * 日汇总表按 UTC 日写入但保留时间更长；原始日志只从 TS 服务启用时开始写入。
	 * 时区路径必须用这些行补齐早期历史，否则默认 7 天视图会因原始日志保留期而少几天。
	 * @param entityField - 当前 Usage 路由的实体维度
	 * @param filters - 过滤条件
	 * @param page - 分页参数
	 * @returns 日汇总行
	 */
	async listDailyActivityRows(
		entityField: DailyActivityEntityField,
		filters: DailyActivityFilters,
		page: DailyActivityPageOptions,
	): Promise<Array<Record<string, unknown>>> {
		const { table } = this._dailyActivityScope(entityField);
		const base = this._db
			.select()
			.from(table)
			.where(this._dailyActivityWhere(entityField, filters))
			.orderBy(desc(table.date))
			.limit(page.limit);
		// 只在调用方确实传了偏移时才追加 OFFSET：聚合模式（取上限+1 检测溢出）原本就没有 OFFSET，
		// 多带一个 `OFFSET 0` 会让执行计划多一次无谓的 Offset 节点。
		const paged = page.offset !== undefined ? base.offset(page.offset) : base;
		return (await paged) as unknown as Array<Record<string, unknown>>;
	}

	/**
	 * 统计日汇总行数（分页总数）。
	 * @param entityField - 当前 Usage 路由的实体维度
	 * @param filters - 过滤条件
	 * @returns 行数
	 */
	async countDailyActivityRows(entityField: DailyActivityEntityField, filters: DailyActivityFilters): Promise<number> {
		const { table } = this._dailyActivityScope(entityField);
		const rows = await this._db.select({ count: count() }).from(table).where(this._dailyActivityWhere(entityField, filters));
		return Number(rows.at(0)?.count ?? 0);
	}

	// ────────────────────────── 密钥与账号元数据 ──────────────────────────

	/**
	 * 读取仍在使用的密钥元数据。
	 * @param tokens - 密钥哈希
	 * @returns 命中的行（未命中的 token 不返回）
	 */
	async listActiveKeyMetadata(tokens: readonly string[]): Promise<ActiveKeyMetadataRow[]> {
		return (await this._db
			.select({
				token: LiteLLM_VerificationToken.token,
				keyAlias: LiteLLM_VerificationToken.keyAlias,
				keyName: LiteLLM_VerificationToken.keyName,
				teamId: LiteLLM_VerificationToken.teamId,
			})
			.from(LiteLLM_VerificationToken)
			.where(inArray(LiteLLM_VerificationToken.token, [...tokens]))) as ActiveKeyMetadataRow[];
	}

	/**
	 * 读取已删除密钥的元数据。
	 *
	 * 按删除时间倒序：同一个 token 可能被删除后重建，调用方取第一条即为最近一次记录。
	 * @param tokens - 密钥哈希
	 * @returns 已删除的行，按删除时间倒序
	 */
	async listDeletedKeyMetadata(tokens: readonly string[]): Promise<DeletedKeyMetadataRow[]> {
		return (await this._db
			.select({
				token: liteLLM_DeletedVerificationToken.token,
				keyAlias: liteLLM_DeletedVerificationToken.keyAlias,
				keyName: liteLLM_DeletedVerificationToken.keyName,
				teamId: liteLLM_DeletedVerificationToken.teamId,
				deletedAt: liteLLM_DeletedVerificationToken.deletedAt,
			})
			.from(liteLLM_DeletedVerificationToken)
			.where(inArray(liteLLM_DeletedVerificationToken.token, [...tokens]))
			.orderBy(desc(liteLLM_DeletedVerificationToken.deletedAt))) as DeletedKeyMetadataRow[];
	}

	/**
	 * 读取订阅账号的身份信息（邮箱、标签、归属 key、供应商、是否已删除）。
	 * @param accountIds - 订阅账号 ID
	 * @returns 账号元数据行
	 */
	async listSubscriptionAccountMetadata(accountIds: readonly string[]): Promise<
		Array<{
			readonly id: string;
			readonly accountKey: string;
			readonly provider: string;
			readonly email: string | null;
			readonly label: string | null;
			readonly trashedAt: Date | null;
		}>
	> {
		return (await this._db
			.select({
				id: LiteLLM_SubscriptionAccount.account_id,
				accountKey: LiteLLM_SubscriptionAccount.account_key,
				provider: LiteLLM_SubscriptionAccount.provider,
				email: sql<string | null>`${LiteLLM_SubscriptionAccount.payload}->>'email'`,
				label: sql<string | null>`${LiteLLM_SubscriptionAccount.payload}->>'label'`,
				trashedAt: LiteLLM_SubscriptionAccount.trashed_at,
			})
			.from(LiteLLM_SubscriptionAccount)
			.where(inArray(LiteLLM_SubscriptionAccount.account_id, [...accountIds]))) as Array<{
			readonly id: string;
			readonly accountKey: string;
			readonly provider: string;
			readonly email: string | null;
			readonly label: string | null;
			readonly trashedAt: Date | null;
		}>;
	}

	/**
	 * 侧栏用量指示器：已用用户数与团队数。
	 * @returns 两个计数
	 */
	async countUsersAndTeams(): Promise<{ readonly users: number; readonly teams: number }> {
		const [userRows, teamRows] = await Promise.all([
			this._db.select({ value: count() }).from(LiteLLM_UserTable),
			this._db.select({ value: count() }).from(LiteLLM_TeamTable),
		]);
		return { users: Number(userRows.at(0)?.value ?? 0), teams: Number(teamRows.at(0)?.value ?? 0) };
	}

	// ────────────────────────── 内部：维度与条件 ──────────────────────────

	/**
	 * 维度 → 日汇总表与实体列。
	 *
	 * 六张日汇总表结构一致，只有表名与实体列不同；这里集中映射，调用方只传维度名，
	 * 避免业务代码直接持有表对象。
	 * @param entityField - 实体维度
	 * @throws {Error} 维度名不在六张表之内时拒绝静默使用错误的表
	 */
	private _dailyActivityScope(entityField: DailyActivityEntityField): {
		readonly table:
			| typeof liteLLM_DailyUserSpend
			| typeof liteLLM_DailyTagSpend
			| typeof liteLLM_DailyTeamSpend
			| typeof liteLLM_DailyOrganizationSpend
			| typeof liteLLM_DailyEndUserSpend
			| typeof liteLLM_DailyAgentSpend;
		readonly entityColumn:
			| typeof liteLLM_DailyUserSpend.user_id
			| typeof liteLLM_DailyTagSpend.tag
			| typeof liteLLM_DailyTeamSpend.team_id
			| typeof liteLLM_DailyOrganizationSpend.organization_id
			| typeof liteLLM_DailyEndUserSpend.end_user_id
			| typeof liteLLM_DailyAgentSpend.agent_id;
	} {
		switch (entityField) {
			case "user_id":
				return { table: liteLLM_DailyUserSpend, entityColumn: liteLLM_DailyUserSpend.user_id };
			case "tag":
				return { table: liteLLM_DailyTagSpend, entityColumn: liteLLM_DailyTagSpend.tag };
			case "team_id":
				return { table: liteLLM_DailyTeamSpend, entityColumn: liteLLM_DailyTeamSpend.team_id };
			case "organization_id":
				return { table: liteLLM_DailyOrganizationSpend, entityColumn: liteLLM_DailyOrganizationSpend.organization_id };
			case "end_user_id":
				return { table: liteLLM_DailyEndUserSpend, entityColumn: liteLLM_DailyEndUserSpend.end_user_id };
			case "agent_id":
				return { table: liteLLM_DailyAgentSpend, entityColumn: liteLLM_DailyAgentSpend.agent_id };
			default:
				throw new Error(`Unsupported daily activity entity: ${String(entityField)}`);
		}
	}

	/**
	 * 原始 SpendLogs 中用于各 Usage 维度的实体列；tag 通过 JSON 数组展开。
	 * @param entityField - 实体维度
	 * @throws {Error} 维度名不在已知列之内时拒绝静默使用错误的列
	 */
	private _spendLogEntityExpression(entityField: DailyActivityEntityField): SQL {
		switch (entityField) {
			case "user_id":
				return sql`${liteLLM_SpendLogs.user}`;
			case "team_id":
				return sql`${liteLLM_SpendLogs.team_id}`;
			case "organization_id":
				return sql`${liteLLM_SpendLogs.organization_id}`;
			case "end_user_id":
				return sql`${liteLLM_SpendLogs.end_user}`;
			case "agent_id":
				return sql`${liteLLM_SpendLogs.agent_id}`;
			case "tag":
				return sql`request_tag.tag_value`;
			default:
				throw new Error(`Unsupported daily activity entity: ${String(entityField)}`);
		}
	}

	/**
	 * 日汇总表的 Usage 查询条件。
	 *
	 * 时区路径只把原始日志尚未覆盖的历史日期交给它，因此日期来自 UTC 日列。
	 * @param entityField - 实体维度
	 * @param filters - 过滤条件
	 * @returns 组合后的条件
	 */
	private _dailyActivityWhere(entityField: DailyActivityEntityField, filters: DailyActivityFilters): SQL {
		const { table, entityColumn } = this._dailyActivityScope(entityField);
		const conditions: SQL[] = [
			gte(table.date, filters.startDate),
			filters.endExclusive ? lt(table.date, filters.endDate) : lte(table.date, filters.endDate),
		];
		const authScope = filters.authScope;
		if (authScope?.entityId !== undefined) {
			conditions.push(eq(entityColumn, authScope.entityId));
		} else if (authScope?.apiKey !== undefined) {
			conditions.push(eq(table.api_key, authScope.apiKey));
		}
		if (filters.entityIds.length > 0) {
			conditions.push(inArray(entityColumn, [...filters.entityIds]));
		} else if (filters.singleEntityId !== undefined) {
			conditions.push(eq(entityColumn, filters.singleEntityId));
		}
		if (filters.excludeEntityIds.length > 0) {
			conditions.push(notInArray(entityColumn, [...filters.excludeEntityIds]));
		}
		if (filters.model !== undefined) {
			conditions.push(eq(table.model, filters.model));
		}
		if (filters.apiKeys.length > 0) {
			conditions.push(inArray(table.api_key, [...filters.apiKeys]));
		}
		if (filters.keySearchPattern !== undefined) {
			conditions.push(this._keySearchCondition(table.api_key, filters.keySearchPattern));
		}
		return and(...conditions) as SQL;
	}

	/**
	 * 密钥搜索条件：直接匹配哈希，或匹配当前/已删除密钥的别名与名称。
	 *
	 * 用 EXISTS 而不是 JOIN：一个 token 在已删除表里可能有多条历史记录，JOIN 会把
	 * SpendLogs 的行放大成多行，聚合出的花费随之翻倍。
	 * @param apiKeyColumn - 待匹配的 api_key 列或表达式
	 * @param pattern - 已转义的 ILIKE pattern
	 * @returns 组合条件
	 */
	private _keySearchCondition(apiKeyColumn: AnyColumn | SQL, pattern: string): SQL {
		return sql`(${apiKeyColumn} ILIKE ${pattern} OR EXISTS (SELECT 1 FROM ${LiteLLM_VerificationToken} WHERE ${LiteLLM_VerificationToken.token} = ${apiKeyColumn} AND (${LiteLLM_VerificationToken.keyAlias} ILIKE ${pattern} OR ${LiteLLM_VerificationToken.keyName} ILIKE ${pattern})) OR EXISTS (SELECT 1 FROM ${liteLLM_DeletedVerificationToken} WHERE ${liteLLM_DeletedVerificationToken.token} = ${apiKeyColumn} AND (${liteLLM_DeletedVerificationToken.keyAlias} ILIKE ${pattern} OR ${liteLLM_DeletedVerificationToken.keyName} ILIKE ${pattern})))`;
	}

	/**
	 * 原始日志的本地日历聚合 SQL。
	 * @param entityField - 实体维度
	 * @param filters - 过滤条件
	 * @param options - 时区与投影开关
	 * @returns 可直接执行的 SQL
	 */
	private _localDailyActivityQuery(
		entityField: DailyActivityEntityField,
		filters: DailyActivityFilters,
		options: DailyActivityLocalQueryOptions,
	): SQL {
		const { timezone, includeEndpoint, includeUpstreamAccount } = options;
		const startDay = filters.startDate;
		const endDay = filters.endDate;
		const logs = liteLLM_SpendLogs;
		const entityExpression = this._spendLogEntityExpression(entityField);
		const conditions: SQL[] = [];
		const range = timezone.name ? null : localDayRangeUtc(startDay, endDay, timezone.offsetMinutes ?? 0);
		if (timezone.name) {
			conditions.push(sql`${logs.startTime} >= ((${startDay}::timestamp AT TIME ZONE ${timezone.name}) AT TIME ZONE 'UTC')`);
			conditions.push(
				sql`${logs.startTime} < ((${nextCalendarDay(endDay)}::timestamp AT TIME ZONE ${timezone.name}) AT TIME ZONE 'UTC')`,
			);
		} else if (range) {
			conditions.push(gte(logs.startTime, range.start));
			conditions.push(sql`${logs.startTime} < ${range.endExclusive}`);
		}

		const authScope = filters.authScope;
		if (authScope?.entityId !== undefined) {
			conditions.push(sql`${entityExpression} = ${authScope.entityId}`);
		} else if (authScope?.apiKey !== undefined) {
			conditions.push(sql`${logs.api_key} = ${authScope.apiKey}`);
		}

		if (filters.entityIds.length > 0) {
			conditions.push(sql`${entityExpression} = ANY(${sql.param([...filters.entityIds])}::text[])`);
		} else if (filters.singleEntityId !== undefined) {
			conditions.push(sql`${entityExpression} = ${filters.singleEntityId}`);
		}
		if (filters.excludeEntityIds.length > 0) {
			conditions.push(sql`NOT (${entityExpression} = ANY(${sql.param([...filters.excludeEntityIds])}::text[]))`);
		}
		if (filters.model !== undefined) {
			conditions.push(sql`${logs.model} = ${filters.model}`);
		}
		if (filters.apiKeys.length > 0) {
			conditions.push(sql`${logs.api_key} = ANY(${sql.param([...filters.apiKeys])}::text[])`);
		}
		if (filters.keySearchPattern !== undefined) {
			conditions.push(this._keySearchCondition(logs.api_key, filters.keySearchPattern));
		}

		const localDate = timezone.name
			? sql`to_char((${logs.startTime} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone.name}, 'YYYY-MM-DD')`
			: sql`to_char(${logs.startTime} + make_interval(mins => ${-(timezone.offsetMinutes ?? 0)}), 'YYYY-MM-DD')`;
		const tagJoin =
			entityField === "tag"
				? sql`CROSS JOIN LATERAL (
				SELECT DISTINCT tag_element AS tag_value
				FROM jsonb_array_elements_text(COALESCE(${logs.request_tags}, '[]'::jsonb)) AS tag_element
			) request_tag`
				: sql``;
		// 账号维度只在这个视图 join 关联表。JOIN 不放大行数（key_hash 是主键），
		// 但会让其它维度多读一张表，因此按视图显式开启。
		const accountJoin = includeUpstreamAccount
			? sql`LEFT JOIN "LiteLLM_UpstreamKeyAccount" AS uka ON uka.key_hash = ${logs.upstream_key_hash}`
			: sql``;
		const where = conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`TRUE`;
		// cache token、resolved model group 和 endpoint 都由写入侧投影成小列；
		// 本地时区聚合不再为每一行解压 metadata / proxy_server_request。
		const endpointExpression = includeEndpoint ? sql`COALESCE(${logs.endpoint}, '')` : sql`NULL::text`;
		const accountKeyExpression = includeUpstreamAccount
			? sql`COALESCE(uka.account_kind || ':' || uka.account_id, 'key:' || ${logs.upstream_key_hash}, 'unattributed')`
			: sql`NULL::text`;
		const accountKindExpression = includeUpstreamAccount ? sql`uka.account_kind` : sql`NULL::text`;
		const accountIdExpression = includeUpstreamAccount ? sql`uka.account_id` : sql`NULL::text`;
		// 同一账号可能在一段时间内轮换过多个 key；把所有出现过的 hash 聚合回来，
		// 明细页才能显示真实 key 版本数，而不是只显示 MAX 那一个。
		const keyHashesExpression = includeUpstreamAccount
			? sql`COALESCE(
				jsonb_agg(DISTINCT ${logs.upstream_key_hash}) FILTER (WHERE ${logs.upstream_key_hash} IS NOT NULL),
				'[]'::jsonb
			)`
			: sql`'[]'::jsonb`;
		const maxKeyHashExpression = includeUpstreamAccount ? sql`MAX(${logs.upstream_key_hash})` : sql`NULL::text`;
		const groupBy = includeUpstreamAccount ? sql`1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11` : sql`1, 2, 3, 4, 5, 6, 7, 8`;
		return sql`
		SELECT
			${localDate} AS date,
			${logs.api_key} AS api_key,
			COALESCE(${logs.model}, '') AS model,
			COALESCE(NULLIF(${logs.resolved_model_group}, ''), NULLIF(${logs.model_group}, '')) AS model_group,
			COALESCE(${logs.custom_llm_provider}, '') AS custom_llm_provider,
			COALESCE(${logs.mcp_namespaced_tool_name}, '') AS mcp_namespaced_tool_name,
			${endpointExpression} AS endpoint,
			${entityExpression} AS ${sql.raw(`"${entityField}"`)},
			${accountKeyExpression} AS upstream_account_key,
			${accountKindExpression} AS upstream_account_kind,
			${accountIdExpression} AS upstream_account_id,
			${maxKeyHashExpression} AS upstream_key_hash,
			${keyHashesExpression} AS upstream_key_hashes,
			COALESCE(SUM(${logs.prompt_tokens}), 0)::bigint AS prompt_tokens,
			COALESCE(SUM(${logs.completion_tokens}), 0)::bigint AS completion_tokens,
			COALESCE(SUM(${logs.cache_read_input_tokens}), 0)::bigint AS cache_read_input_tokens,
			COALESCE(SUM(${logs.cache_creation_input_tokens}), 0)::bigint AS cache_creation_input_tokens,
			COALESCE(SUM(${logs.spend}), 0)::double precision AS spend,
			COUNT(*)::bigint AS api_requests,
			COUNT(*) FILTER (WHERE COALESCE(${logs.status}, 'success') = 'success')::bigint AS successful_requests,
			COUNT(*) FILTER (WHERE COALESCE(${logs.status}, 'success') = 'failure')::bigint AS failed_requests
		FROM ${logs}
		${accountJoin}
		${tagJoin}
		WHERE ${where}
		GROUP BY ${groupBy}
		ORDER BY 1 DESC
	`;
	}
}
