/**
 * LiteLLM_SpendLogBlocks 仓库 — 内容寻址块表的全部读写。
 *
 * 块按内容寻址、只增不删，跨请求共享；每次写入都可能是「已存在的一份」，因此写侧
 * 只需要判存 + 盲插。表按请求增长、内容不可变，没有整表副本或按键缓存的意义：
 * 进程内的载荷 LRU 是读取侧优化（见 `SpendLogBlocks`），不属于持久层。
 *
 * 读取与写入都可能发生在事务里（结算/回收），所以方法接收调用方句柄，默认使用
 * 仓储绑定的连接。
 */

import { inArray } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_SpendLogBlocks } from "../db/schema/spendLogBlocks";
import { singletonFor } from "./internal/registry";

/** 事务句柄；结算/回收时块写入必须与 SpendLog 行同事务。 */
export type SpendLogBlockTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/** 可用于块表读写的句柄：普通连接或事务。 */
export type SpendLogBlockExecutor = DrizzleDb | SpendLogBlockTransaction;

/** 一条待写入的内容寻址块。 */
export interface SpendLogBlockInsert {
	/** 内容规范化 JSON 的 SHA-256 前 128 位（base64url）。 */
	readonly blockId: string;
	/** 块内容。 */
	readonly payload: unknown;
	/** 规范化 JSON 的字节长度。 */
	readonly byteSize: number;
}

/** 块表的一行（读取投影）。 */
export interface SpendLogBlockPayload {
	/** 块 id。 */
	readonly blockId: string;
	/** 块内容。 */
	readonly payload: unknown;
	/** 字节长度。 */
	readonly byteSize: number;
}

/**
 * 单次 `IN (...)` 查询的 id 上限。
 *
 * 5000 个 22 字符的 id 约 110 KB 绑定参数，远低于 PostgreSQL 的单语句参数上限；
 * 再大则拆批，避免超长会话一次组装把语句顶爆。
 */
export const SPEND_LOG_BLOCK_LOOKUP_CHUNK_SIZE = 5_000;

/** 单次 INSERT 的块数上限；同样是为了控制绑定参数数量。 */
export const SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE = 1_000;

/**
 * 取得与数据库连接绑定的块仓库。
 * @param db - Drizzle 数据库实例
 */
export const spendLogBlockRepositoryFor = singletonFor((db: DrizzleDb) => new SpendLogBlockRepository(db));

/** `LiteLLM_SpendLogBlocks` 的 SQL 访问点。 */
export class SpendLogBlockRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 批量读取块内容；不存在的 id 不会出现在结果里。
	 * @param ids - 引用 id 列表（会自动去重）
	 * @param executor - 数据库或事务句柄；缺省用仓储连接
	 * @returns 命中的块行
	 */
	async findPayloads(ids: readonly string[], executor: SpendLogBlockExecutor = this._db): Promise<SpendLogBlockPayload[]> {
		const uniqueIds = [...new Set(ids)];
		const rows: SpendLogBlockPayload[] = [];
		for (let offset = 0; offset < uniqueIds.length; offset += SPEND_LOG_BLOCK_LOOKUP_CHUNK_SIZE) {
			const chunk = uniqueIds.slice(offset, offset + SPEND_LOG_BLOCK_LOOKUP_CHUNK_SIZE);
			const found = await executor
				.select({
					blockId: liteLLM_SpendLogBlocks.blockId,
					payload: liteLLM_SpendLogBlocks.payload,
					byteSize: liteLLM_SpendLogBlocks.byteSize,
				})
				.from(liteLLM_SpendLogBlocks)
				.where(inArray(liteLLM_SpendLogBlocks.blockId, chunk));
			rows.push(...found);
		}
		return rows;
	}

	/**
	 * 查询哪些块 id 已经存在于块表。
	 * @param ids - 待查询的块 id
	 * @param executor - 数据库或事务句柄；缺省用仓储连接
	 * @returns 已存在的 id 集合
	 */
	async findExistingIds(ids: readonly string[], executor: SpendLogBlockExecutor = this._db): Promise<Set<string>> {
		const existing = new Set<string>();
		for (let offset = 0; offset < ids.length; offset += SPEND_LOG_BLOCK_LOOKUP_CHUNK_SIZE) {
			const chunk = ids.slice(offset, offset + SPEND_LOG_BLOCK_LOOKUP_CHUNK_SIZE);
			const rows = await executor
				.select({ blockId: liteLLM_SpendLogBlocks.blockId })
				.from(liteLLM_SpendLogBlocks)
				.where(inArray(liteLLM_SpendLogBlocks.blockId, chunk));
			for (const row of rows) {
				existing.add(row.blockId);
			}
		}
		return existing;
	}

	/**
	 * 分批盲插块；重复 id 按冲突丢弃。
	 *
	 * 块由内容寻址，重复写入无需先查；分批是为了避免超长会话把绑定参数数量顶到
	 * PostgreSQL 上限。
	 * @param blocks - 待写入的块（应为判存确认缺失的部分）
	 * @param executor - 数据库或事务句柄；缺省用仓储连接
	 */
	async insertIgnore(blocks: readonly SpendLogBlockInsert[], executor: SpendLogBlockExecutor = this._db): Promise<void> {
		for (let offset = 0; offset < blocks.length; offset += SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE) {
			await executor
				.insert(liteLLM_SpendLogBlocks)
				.values(blocks.slice(offset, offset + SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE).map((block) => ({ ...block })))
				.onConflictDoNothing();
		}
	}
}
