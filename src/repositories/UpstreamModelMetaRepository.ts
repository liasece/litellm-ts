/**
 * 上游模型元信息仓库 - LiteLLM_UpstreamModelMeta 的唯一访问点。
 *
 * 写入按来源整体替换（一次拉取的结果就是该来源的完整视图），读取在启动时一次性装载
 * 到内存；运行期不做按模型的数据库查询，避免把「上游元信息」变成请求路径上的 I/O。
 */

import { and, eq, notInArray } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { singletonFor } from "./internal/registry";
import { LiteLLM_UpstreamModelMeta } from "../db/schema/upstreamModelMeta";
import type { UpstreamModelMetaRecord, UpstreamModelMetaStatus, UpstreamModelMetadata } from "../subscriptions/native/upstream/types";

/** 一行待写入的记录（除时间戳外与读取形态一致）。 */
export interface UpstreamModelMetaWrite {
	/**
	 *
	 */
	readonly source: UpstreamModelMetaRecord["source"];
	/**
	 *
	 */
	readonly modelId: string;
	/**
	 *
	 */
	readonly status: UpstreamModelMetaStatus;
	/**
	 *
	 */
	readonly displayName?: string;
	/**
	 *
	 */
	readonly metadata?: UpstreamModelMetadata;
	/**
	 *
	 */
	readonly raw?: unknown;
	/**
	 *
	 */
	readonly error?: string;
	/**
	 *
	 */
	readonly fetchedAt: Date;
	/**
	 *
	 */
	readonly expiresAt: Date;
}

/**
 * 数据库行 → 领域记录。
 * @param row
 */
function toRecord(row: typeof LiteLLM_UpstreamModelMeta.$inferSelect): UpstreamModelMetaRecord {
	return {
		source: row.source as UpstreamModelMetaRecord["source"],
		modelId: row.model_id,
		status: row.status,
		displayName: row.display_name ?? undefined,
		metadata: (row.metadata ?? undefined) as UpstreamModelMetadata | undefined,
		raw: row.raw ?? undefined,
		error: row.error ?? undefined,
		fetchedAt: row.fetched_at,
		expiresAt: row.expires_at,
	};
}

/** 上游模型元信息仓库。 */
export class UpstreamModelMetaRepository {
	constructor(private readonly _db: DrizzleDb) {}

	/**
	 * 读取全部缓存行。
	 * @returns 记录列表；空表返回空数组
	 */
	async listAll(): Promise<UpstreamModelMetaRecord[]> {
		const rows = await this._db.select().from(LiteLLM_UpstreamModelMeta);
		return rows.map(toRecord);
	}

	/**
	 * 用一次拉取的结果整体替换某来源的模型行。
	 *
	 * 拉取失败时调用方不应调用本方法：旧行保留为 stale 值，比清空更有用。
	 * @param source - 来源
	 * @param records - 本次拉取到的模型行（不含来源级状态行）
	 */
	async replaceSource(source: UpstreamModelMetaRecord["source"], records: readonly UpstreamModelMetaWrite[]): Promise<void> {
		await this._db.transaction(async (tx) => {
			const modelIds = records.map((record) => record.modelId);
			if (modelIds.length === 0) {
				await tx
					.delete(LiteLLM_UpstreamModelMeta)
					.where(and(eq(LiteLLM_UpstreamModelMeta.source, source), notInArray(LiteLLM_UpstreamModelMeta.model_id, ["*"])));
				return;
			}
			await tx
				.delete(LiteLLM_UpstreamModelMeta)
				.where(and(eq(LiteLLM_UpstreamModelMeta.source, source), notInArray(LiteLLM_UpstreamModelMeta.model_id, modelIds)));
			for (const record of records) {
				await this.upsert(record, tx);
			}
		});
	}

	/**
	 * 写入或更新一行。
	 * @param record - 待写入记录
	 * @param tx - 事务句柄；缺省时使用连接本身
	 */
	async upsert(record: UpstreamModelMetaWrite, tx?: DrizzleDb): Promise<void> {
		const db = tx ?? this._db;
		const values = {
			source: record.source,
			model_id: record.modelId,
			status: record.status,
			display_name: record.displayName ?? null,
			metadata: record.metadata ?? null,
			raw: record.raw ?? null,
			error: record.error ?? null,
			fetched_at: record.fetchedAt,
			expires_at: record.expiresAt,
		};
		await db
			.insert(LiteLLM_UpstreamModelMeta)
			.values(values)
			.onConflictDoUpdate({
				target: [LiteLLM_UpstreamModelMeta.source, LiteLLM_UpstreamModelMeta.model_id],
				set: {
					status: values.status,
					display_name: values.display_name,
					metadata: values.metadata,
					raw: values.raw,
					error: values.error,
					fetched_at: values.fetched_at,
					expires_at: values.expires_at,
				},
			});
	}

	/**
	 * 删除某来源的全部行（含来源级状态行）。
	 * @param source - 来源
	 */
	async deleteSource(source: UpstreamModelMetaRecord["source"]): Promise<void> {
		await this._db.delete(LiteLLM_UpstreamModelMeta).where(eq(LiteLLM_UpstreamModelMeta.source, source));
	}
}

/**
 * 按 db 实例取仓储单例（同一个 db 只构造一次）。
 * @param db - drizzle 句柄
 */
export const upstreamModelMetaRepositoryFor = singletonFor((db: DrizzleDb) => new UpstreamModelMetaRepository(db));
