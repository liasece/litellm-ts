/**
 * 脱敏观测数据仓库。
 *
 * 只保存派生信息，不保存原文：
 * - 请求级：处数、值数、类型分布、客户端/提供方、耗时；
 * - 值级：类型、HMAC 指纹、长度、前 3 个字符、出现次数。
 *
 * 写入发生在响应结束之后（异步、失败只记日志），不阻塞请求；保留期清理按小时节流。
 */
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_PrivacyRedactionEvents, liteLLM_PrivacyRedactionValues } from "../db/schema/privacyRedaction";
import type { PrivacyValueStat } from "./PrivacyContext";

/** 单次请求的写入内容 */
export interface PrivacyRecordInput {
	/** 与 SpendLog 共用的请求 ID */
	readonly requestId: string;
	/** 认证信息里的 key（用于排查，不展示完整 key） */
	readonly apiKey: string;
	/** 用户 ID */
	readonly userId: string | null;
	/** 团队 ID */
	readonly teamId: string | null;
	/** 客户端标识 */
	readonly client: string;
	/** 上游提供方 */
	readonly provider: string;
	/** 模型名 */
	readonly model: string;
	/** 各类型处数 */
	readonly kinds: Readonly<Record<string, number>>;
	/** 处数 */
	readonly occurrences: number;
	/** 值数 */
	readonly distinctValues: number;
	/** 处置动作 */
	readonly action: string;
	/** 耗时（毫秒） */
	readonly durationMs: number;
	/** 无法还原的占位符数量 */
	readonly unresolved: number;
	/** 值级明细 */
	readonly values: readonly PrivacyValueStat[];
}

/** 概览统计 */
export interface PrivacyOverview {
	/** 汇总卡片 */
	readonly summary: {
		/** 替换处数 */
		readonly occurrences: number;
		/** 不同值数量 */
		readonly distinctValues: number;
		/** 请求数 */
		readonly requests: number;
		/** 无法还原的占位符数量 */
		readonly unresolved: number;
	};
	/** 按客户端分组 */
	readonly byClient: ReadonlyArray<{ readonly name: string; readonly occurrences: number; readonly requests: number }>;
	/** 按提供方分组 */
	readonly byProvider: ReadonlyArray<{ readonly name: string; readonly occurrences: number; readonly requests: number }>;
	/** 按类型分组 */
	readonly byKind: ReadonlyArray<{ readonly name: string; readonly occurrences: number; readonly values: number }>;
	/** 最近 24 小时逐小时处数（仅 7 天视图使用） */
	readonly series: ReadonlyArray<{ readonly bucket: string; readonly occurrences: number }>;
}

/** 请求级列表行 */
export interface PrivacyRequestRow {
	/** 请求 ID */
	readonly requestId: string;
	/** 时间 */
	readonly createdAt: string;
	/** 客户端 */
	readonly client: string;
	/** 提供方 */
	readonly provider: string;
	/** 模型 */
	readonly model: string;
	/** 处数 */
	readonly occurrences: number;
	/** 值数 */
	readonly distinctValues: number;
	/** 类型分布 */
	readonly kinds: Record<string, number>;
	/** 处置 */
	readonly action: string;
	/** 耗时 */
	readonly durationMs: number;
	/** 无法还原数量 */
	readonly unresolved: number;
}

/** 值级列表行 */
export interface PrivacyValueRow {
	/** 类型 */
	readonly kind: string;
	/** 指纹 */
	readonly hash: string;
	/** 原文长度 */
	readonly length: number;
	/** 前 3 个字符 */
	readonly hint: string;
	/** 出现次数 */
	readonly occurrences: number;
	/** 涉及请求数 */
	readonly requests: number;
	/** 涉及的客户端 */
	readonly clients: string[];
	/** 最近出现时间 */
	readonly lastSeen: string;
}

/** 列表过滤条件 */
export interface PrivacyListFilter {
	/** 时间范围（天） */
	readonly days: number;
	/** 客户端过滤 */
	readonly client?: string;
	/** 提供方过滤 */
	readonly provider?: string;
	/** 类型过滤 */
	readonly kind?: string;
	/** 条数上限 */
	readonly limit: number;
	/** 偏移 */
	readonly offset: number;
}

/** 保留期清理节流间隔（毫秒） */
const PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

/** 上次清理时间 */
let lastPruneAt = 0;

/**
 * 把 pg 返回的 bigint/数字/字符串统一成 number。
 * @param value - 原始值
 */
function toNumber(value: unknown): number {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : 0;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

/**
 * 读取字符串列。
 * @param value - 原始值
 */
function toText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** 脱敏观测仓库 */
export class PrivacyStatsRepository {
	private readonly _db: DrizzleDb;

	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		this._db = db;
	}

	/**
	 * 写入一次请求的脱敏统计。
	 * @param input - 统计内容
	 * @param retentionDays - 观测数据保留天数
	 */
	async record(input: PrivacyRecordInput, retentionDays = 30): Promise<void> {
		if (input.occurrences <= 0) {
			return;
		}
		const createdAt = new Date();
		await this._db.insert(liteLLM_PrivacyRedactionEvents).values({
			request_id: input.requestId,
			created_at: createdAt,
			api_key: input.apiKey,
			user_id: input.userId,
			team_id: input.teamId,
			client: input.client,
			provider: input.provider,
			model: input.model,
			kinds: { ...input.kinds },
			occurrences: input.occurrences,
			distinct_values: input.distinctValues,
			action: input.action,
			duration_ms: input.durationMs,
			unresolved: input.unresolved,
		});
		if (input.values.length > 0) {
			await this._db.insert(liteLLM_PrivacyRedactionValues).values(
				input.values.map((item) => ({
					request_id: input.requestId,
					created_at: createdAt,
					kind: item.kind,
					value_hash: item.hash,
					value_length: item.length,
					hint: item.hint,
					occurrences: item.occurrences,
					client: input.client,
					provider: input.provider,
					model: input.model,
				})),
			);
		}
		await this.pruneIfDue(retentionDays);
	}

	/**
	 * 概览统计。
	 * @param days - 时间范围（天）
	 */
	async overview(days: number): Promise<PrivacyOverview> {
		const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
		const summaryRows = await this._db
			.select({
				occurrences: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionEvents.occurrences}), 0)`,
				requests: sql<string>`count(*)`,
				unresolved: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionEvents.unresolved}), 0)`,
			})
			.from(liteLLM_PrivacyRedactionEvents)
			.where(gte(liteLLM_PrivacyRedactionEvents.created_at, since));
		const distinctRows = await this._db
			.select({ distinctValues: sql<string>`count(distinct (${liteLLM_PrivacyRedactionValues.kind}, ${liteLLM_PrivacyRedactionValues.value_hash}))` })
			.from(liteLLM_PrivacyRedactionValues)
			.where(gte(liteLLM_PrivacyRedactionValues.created_at, since));
		const summary = summaryRows[0];
		const distinct = distinctRows[0];

		const byClientRows = await this._db
			.select({
				name: liteLLM_PrivacyRedactionEvents.client,
				occurrences: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionEvents.occurrences}), 0)`,
				requests: sql<string>`count(*)`,
			})
			.from(liteLLM_PrivacyRedactionEvents)
			.where(gte(liteLLM_PrivacyRedactionEvents.created_at, since))
			.groupBy(liteLLM_PrivacyRedactionEvents.client)
			.orderBy(desc(sql`sum(${liteLLM_PrivacyRedactionEvents.occurrences})`));

		const byProviderRows = await this._db
			.select({
				name: liteLLM_PrivacyRedactionEvents.provider,
				occurrences: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionEvents.occurrences}), 0)`,
				requests: sql<string>`count(*)`,
			})
			.from(liteLLM_PrivacyRedactionEvents)
			.where(gte(liteLLM_PrivacyRedactionEvents.created_at, since))
			.groupBy(liteLLM_PrivacyRedactionEvents.provider)
			.orderBy(desc(sql`sum(${liteLLM_PrivacyRedactionEvents.occurrences})`));

		const byKindRows = await this._db
			.select({
				name: liteLLM_PrivacyRedactionValues.kind,
				occurrences: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionValues.occurrences}), 0)`,
				values: sql<string>`count(distinct ${liteLLM_PrivacyRedactionValues.value_hash})`,
			})
			.from(liteLLM_PrivacyRedactionValues)
			.where(gte(liteLLM_PrivacyRedactionValues.created_at, since))
			.groupBy(liteLLM_PrivacyRedactionValues.kind)
			.orderBy(desc(sql`sum(${liteLLM_PrivacyRedactionValues.occurrences})`));

		const seriesRows = await this._db
			.select({
				bucket: sql<string>`to_char(date_trunc('hour', ${liteLLM_PrivacyRedactionEvents.created_at}), 'YYYY-MM-DD HH24:00')`,
				occurrences: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionEvents.occurrences}), 0)`,
			})
			.from(liteLLM_PrivacyRedactionEvents)
			.where(gte(liteLLM_PrivacyRedactionEvents.created_at, new Date(Date.now() - 24 * 60 * 60 * 1_000)))
			.groupBy(sql`date_trunc('hour', ${liteLLM_PrivacyRedactionEvents.created_at})`)
			.orderBy(sql`date_trunc('hour', ${liteLLM_PrivacyRedactionEvents.created_at})`);

		return {
			summary: {
				occurrences: toNumber(summary?.occurrences),
				distinctValues: toNumber(distinct?.distinctValues),
				requests: toNumber(summary?.requests),
				unresolved: toNumber(summary?.unresolved),
			},
			byClient: byClientRows.map((row) => ({
				name: toText(row.name),
				occurrences: toNumber(row.occurrences),
				requests: toNumber(row.requests),
			})),
			byProvider: byProviderRows.map((row) => ({
				name: toText(row.name),
				occurrences: toNumber(row.occurrences),
				requests: toNumber(row.requests),
			})),
			byKind: byKindRows.map((row) => ({
				name: toText(row.name),
				occurrences: toNumber(row.occurrences),
				values: toNumber(row.values),
			})),
			series: seriesRows.map((row) => ({
				bucket: toText(row.bucket),
				occurrences: toNumber(row.occurrences),
			})),
		};
	}

	/**
	 * 请求级明细。
	 * @param filter - 过滤与分页
	 */
	async listRequests(filter: PrivacyListFilter): Promise<PrivacyRequestRow[]> {
		const since = new Date(Date.now() - filter.days * 24 * 60 * 60 * 1_000);
		const conditions = [gte(liteLLM_PrivacyRedactionEvents.created_at, since)];
		if (filter.client !== undefined && filter.client.length > 0) {
			conditions.push(eq(liteLLM_PrivacyRedactionEvents.client, filter.client));
		}
		if (filter.provider !== undefined && filter.provider.length > 0) {
			conditions.push(eq(liteLLM_PrivacyRedactionEvents.provider, filter.provider));
		}
		const rows = await this._db
			.select()
			.from(liteLLM_PrivacyRedactionEvents)
			.where(and(...conditions))
			.orderBy(desc(liteLLM_PrivacyRedactionEvents.created_at))
			.limit(filter.limit)
			.offset(filter.offset);
		return rows.map((row) => ({
			requestId: row.request_id,
			createdAt: row.created_at.toISOString(),
			client: row.client,
			provider: row.provider,
			model: row.model,
			occurrences: row.occurrences,
			distinctValues: row.distinct_values,
			kinds: row.kinds ?? {},
			action: row.action,
			durationMs: row.duration_ms,
			unresolved: row.unresolved,
		}));
	}

	/**
	 * 值级明细（按指纹聚合）。
	 * @param filter - 过滤与分页
	 */
	async listValues(filter: PrivacyListFilter): Promise<PrivacyValueRow[]> {
		const since = new Date(Date.now() - filter.days * 24 * 60 * 60 * 1_000);
		const conditions = [gte(liteLLM_PrivacyRedactionValues.created_at, since)];
		if (filter.client !== undefined && filter.client.length > 0) {
			conditions.push(eq(liteLLM_PrivacyRedactionValues.client, filter.client));
		}
		if (filter.provider !== undefined && filter.provider.length > 0) {
			conditions.push(eq(liteLLM_PrivacyRedactionValues.provider, filter.provider));
		}
		if (filter.kind !== undefined && filter.kind.length > 0) {
			conditions.push(eq(liteLLM_PrivacyRedactionValues.kind, filter.kind));
		}
		const rows = await this._db
			.select({
				kind: liteLLM_PrivacyRedactionValues.kind,
				hash: liteLLM_PrivacyRedactionValues.value_hash,
				length: sql<string>`max(${liteLLM_PrivacyRedactionValues.value_length})`,
				hint: sql<string>`min(${liteLLM_PrivacyRedactionValues.hint})`,
				occurrences: sql<string>`coalesce(sum(${liteLLM_PrivacyRedactionValues.occurrences}), 0)`,
				requests: sql<string>`count(distinct ${liteLLM_PrivacyRedactionValues.request_id})`,
				clients: sql<string>`string_agg(distinct ${liteLLM_PrivacyRedactionValues.client}, ',')`,
				lastSeen: sql<string>`max(${liteLLM_PrivacyRedactionValues.created_at})`,
			})
			.from(liteLLM_PrivacyRedactionValues)
			.where(and(...conditions))
			.groupBy(liteLLM_PrivacyRedactionValues.kind, liteLLM_PrivacyRedactionValues.value_hash)
			.orderBy(desc(sql`sum(${liteLLM_PrivacyRedactionValues.occurrences})`))
			.limit(filter.limit)
			.offset(filter.offset);
		return rows.map((row) => ({
			kind: toText(row.kind),
			hash: toText(row.hash),
			length: toNumber(row.length),
			hint: toText(row.hint),
			occurrences: toNumber(row.occurrences),
			requests: toNumber(row.requests),
			clients: toText(row.clients)
				.split(",")
				.filter((item) => item.length > 0),
			lastSeen: new Date(toText(row.lastSeen)).toISOString(),
		}));
	}

	/**
	 * 按保留期清理过期观测数据（每小时最多执行一次）。
	 * @param retentionDays - 观测数据保留天数
	 */
	async pruneIfDue(retentionDays: number): Promise<void> {
		const now = Date.now();
		if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
			return;
		}
		lastPruneAt = now;
		await this.prune(retentionDays);
	}

	/**
	 * 执行清理。
	 * @param retentionDays - 保留天数，缺省 30
	 */
	async prune(retentionDays = 30): Promise<void> {
		const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
		await this._db.delete(liteLLM_PrivacyRedactionValues).where(lt(liteLLM_PrivacyRedactionValues.created_at, cutoff));
		await this._db.delete(liteLLM_PrivacyRedactionEvents).where(lt(liteLLM_PrivacyRedactionEvents.created_at, cutoff));
	}
}
