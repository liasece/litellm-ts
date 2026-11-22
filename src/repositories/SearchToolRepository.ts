/**
 * LiteLLM_SearchToolsTable 仓库 — 搜索工具配置行的唯一访问点。
 *
 * 这张表只存 Dashboard / YAML 合并后的少量搜索工具，行数是个位到几十的量级，
 * 因此使用整表副本：读路径命中副本，不再为每次列表请求回表；写路径在 SQL 成功后
 * 立即 `upsert` / `remove` 写穿，WebUI 的新增、改名、删除对下一个请求马上可见，
 * 不需要等兜底刷新（默认 5 分钟，只用于兜住绕过本进程直接改库的情况）。
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_SearchToolsTable } from "../db/schema/searchTools";
import { singletonFor, tableCacheFor } from "./internal/registry";
import type { TableCache } from "./internal/TableCache";

/** `LiteLLM_SearchToolsTable` 行。 */
export type SearchToolRow = typeof LiteLLM_SearchToolsTable.$inferSelect;

/** 新建或更新一条搜索工具时可写入的列。 */
export interface SearchToolWriteValues {
	/** 运行时名称，也是与 YAML 配置合并时的去重键。 */
	readonly search_tool_name: string;
	/** 供应商与凭据参数。 */
	readonly litellm_params: Record<string, unknown>;
	/** 只在管理页展示的附加信息；更新时省略表示清空。 */
	readonly search_tool_info?: Record<string, unknown> | null;
}

/**
 * 取得与数据库连接绑定的搜索工具仓库；同一连接上的所有调用方共享同一份副本。
 * @param db - Drizzle 数据库实例
 */
export const searchToolRepositoryFor = singletonFor((db: DrizzleDb) => new SearchToolRepository(db));

/** 搜索工具配置仓库。 */
export class SearchToolRepository extends BaseRepository {
	private readonly _cache: TableCache<SearchToolRow>;

	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
		this._cache = tableCacheFor<SearchToolRow>(db, "LiteLLM_SearchToolsTable", () => db.select().from(LiteLLM_SearchToolsTable));
	}

	/** 外部直接改库后强制重新装载；应用内写路径不需要调用。 */
	invalidateCache(): void {
		this._cache.invalidate();
	}

	/** 读取全部搜索工具行；返回共享副本，调用方只读。 */
	async snapshotRows(): Promise<SearchToolRow[]> {
		return await this._cache.rows();
	}

	/**
	 * 按运行时名称读取搜索工具；名称上有唯一索引，因此最多一行。
	 * @param name - search_tool_name
	 * @returns 命中的行；不存在时返回 undefined
	 */
	async findByName(name: string): Promise<SearchToolRow | undefined> {
		const rows = await this._cache.rows();
		return rows.find((row) => row.search_tool_name === name);
	}

	/**
	 * 按主键读取搜索工具。
	 * @param id - search_tool_id
	 * @returns 命中的行；不存在时返回 undefined
	 */
	async findById(id: string): Promise<SearchToolRow | undefined> {
		const rows = await this._cache.rows();
		return rows.find((row) => row.search_tool_id === id);
	}

	/**
	 * 新建一条搜索工具；主键由本仓库生成，写入成功后立刻合并进副本。
	 * @param values - 待写入列
	 * @returns 实际写入的行；数据库未返回行时返回 undefined
	 */
	async create(values: SearchToolWriteValues): Promise<SearchToolRow | undefined> {
		const inserted = await this._db
			.insert(LiteLLM_SearchToolsTable)
			.values({
				search_tool_id: randomUUID(),
				search_tool_name: values.search_tool_name,
				litellm_params: values.litellm_params,
				...(values.search_tool_info ? { search_tool_info: values.search_tool_info } : {}),
			})
			.returning();
		const row = inserted[0];
		if (row !== undefined) {
			this._cache.upsert(row, (candidate) => candidate.search_tool_id);
		}
		return row;
	}

	/**
	 * 按主键更新搜索工具；更新成功后用返回行替换副本里的同一行。
	 * @param id - search_tool_id
	 * @param values - 待更新列
	 * @returns 更新后的行；该 ID 不存在时返回 undefined
	 */
	async update(id: string, values: SearchToolWriteValues): Promise<SearchToolRow | undefined> {
		const updated = await this._db
			.update(LiteLLM_SearchToolsTable)
			.set({
				search_tool_name: values.search_tool_name,
				litellm_params: values.litellm_params,
				search_tool_info: values.search_tool_info ?? null,
			})
			.where(eq(LiteLLM_SearchToolsTable.search_tool_id, id))
			.returning();
		const row = updated[0];
		if (row !== undefined) {
			this._cache.upsert(row, (candidate) => candidate.search_tool_id);
		}
		return row;
	}

	/**
	 * 按主键删除搜索工具；删除成功后从副本里移除该行。
	 * @param id - search_tool_id
	 * @returns 被删除的行；该 ID 不存在时返回 undefined
	 */
	async remove(id: string): Promise<SearchToolRow | undefined> {
		const deleted = await this._db.delete(LiteLLM_SearchToolsTable).where(eq(LiteLLM_SearchToolsTable.search_tool_id, id)).returning();
		const row = deleted[0];
		if (row !== undefined) {
			this._cache.remove((candidate) => candidate.search_tool_id === row.search_tool_id);
		}
		return row;
	}
}
