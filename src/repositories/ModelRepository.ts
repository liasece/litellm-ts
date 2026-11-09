/**
 * LiteLLM_ProxyModelTable 仓库 — 模型部署行的唯一访问点。
 *
 * 路由快照、模型管理端点、yaml 配置同步和凭据引用检查都经由此仓库读取；
 * 进程内副本也只在这里维护：写入成功后失效，下一次读取重新装载，
 * 因此 WebUI 保存的模型变更对下一个请求立即生效。
 * 外部直接改库由惰性安全刷新在 `SAFETY_REFRESH_MS` 内兜底。
 */
import { eq } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import { revisionCounterFor, TableCache } from "./internal/TableCache";

/** `LiteLLM_ProxyModelTable` 行。 */
export type ModelRow = typeof LiteLLM_ProxyModelTable.$inferSelect;
/** 新建模型部署时可写入的列。 */
export type ModelInsertValues = typeof LiteLLM_ProxyModelTable.$inferInsert;
/** 更新模型部署时可修改的列。 */
export interface ModelUpdateValues {
	/** 对外模型名称。 */
	readonly model_name?: string;
	/** 模型参数（provider、上游模型名、凭据引用等）。 */
	readonly litellm_params?: Record<string, unknown>;
	/** 展示与能力元数据。 */
	readonly model_info?: Record<string, unknown>;
	/** 最近更新者。 */
	readonly updated_by?: string;
	/** 更新时间。 */
	readonly updated_at?: Date;
}
/** 事务句柄；跨仓库写入时由调用方传入，本仓库不自行开启事务。 */
export type ModelTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

const caches = new WeakMap<object, TableCache<ModelRow>>();
const repositories = new WeakMap<object, ModelRepository>();

function cacheFor(db: DrizzleDb): TableCache<ModelRow> {
	const key = db as unknown as object;
	const existing = caches.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new TableCache<ModelRow>(() => db.select().from(LiteLLM_ProxyModelTable), revisionCounterFor(key));
	caches.set(key, created);
	return created;
}

/**
 * 取得与数据库连接绑定的模型仓库；同一连接上的所有调用方共享同一份副本。
 * @param db - Drizzle 数据库实例
 */
export function modelRepositoryFor(db: DrizzleDb): ModelRepository {
	const key = db as unknown as object;
	const existing = repositories.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new ModelRepository(db);
	repositories.set(key, created);
	return created;
}

/**
 *
 */
export class ModelRepository extends BaseRepository {
	private readonly _cache: TableCache<ModelRow>;

	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
		this._cache = cacheFor(db);
	}

	/** 当前副本版本号，供请求级快照判重。 */
	revision(): number {
		return this._cache.revision();
	}

	/** 读取全部模型部署行；返回共享副本，调用方只读。 */
	async snapshotRows(): Promise<ModelRow[]> {
		return await this._cache.rows();
	}

	/** 外部直接改库后强制重新装载；应用内写路径不需要调用。 */
	invalidateCache(): void {
		this._cache.invalidate();
	}

	/**
	 * 按主键读取模型部署行。
	 * @param modelId - LiteLLM_ProxyModelTable.model_id
	 */
	async findById(modelId: string): Promise<ModelRow | null> {
		const rows = await this._cache.rows();
		return rows.find((row) => row.model_id === modelId) ?? null;
	}

	/**
	 * 判断是否有模型通过 `litellm_credential_name` 引用该凭据。
	 * @param credentialName - 凭据名称
	 * @param tx - 可选事务句柄；传入时在该事务内全量读取，保证与调用方同一快照
	 */
	async isCredentialReferenced(credentialName: string, tx?: ModelTransaction): Promise<boolean> {
		const rows = tx === undefined ? await this._cache.rows() : await tx.select().from(LiteLLM_ProxyModelTable);
		return rows.some((row) => isRecord(row.litellm_params) && row.litellm_params["litellm_credential_name"] === credentialName);
	}

	/**
	 * 新建模型部署行。
	 * @param values - 可写入的列
	 */
	async create(values: ModelInsertValues): Promise<ModelRow> {
		const inserted = await this._db.insert(LiteLLM_ProxyModelTable).values(values).returning();
		const row = inserted.at(0);
		if (row === undefined) {
			throw new Error("模型插入未返回数据行");
		}
		this._cache.invalidate();
		return row;
	}

	/**
	 * 更新模型部署行。
	 * @param modelId - LiteLLM_ProxyModelTable.model_id
	 * @param values - 待更新列
	 */
	async update(modelId: string, values: ModelUpdateValues): Promise<ModelRow | null> {
		const updated = await this._db
			.update(LiteLLM_ProxyModelTable)
			.set(values)
			.where(eq(LiteLLM_ProxyModelTable.model_id, modelId))
			.returning();
		const row = updated.at(0);
		if (row === undefined) {
			return null;
		}
		this._cache.invalidate();
		return row;
	}

	/**
	 * 删除模型部署行。
	 * @param modelId - LiteLLM_ProxyModelTable.model_id
	 */
	async remove(modelId: string): Promise<boolean> {
		const result = await this._db.delete(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId));
		const deleted = result.rowCount ?? 0;
		if (deleted > 0) {
			this._cache.invalidate();
		}
		return deleted > 0;
	}

	/**
	 * yaml 配置同步：按 model_id upsert 一行模型部署。
	 * @param values - 可写入的列
	 */
	async upsertFromYaml(values: ModelInsertValues): Promise<void> {
		await this._db
			.insert(LiteLLM_ProxyModelTable)
			.values(values)
			.onConflictDoUpdate({
				target: LiteLLM_ProxyModelTable.model_id,
				set: {
					model_name: values.model_name,
					litellm_params: values.litellm_params,
					model_info: values.model_info,
					updated_by: values.updated_by,
					updated_at: new Date(),
				},
			});
		this._cache.invalidate();
	}

	/**
	 * 在事务内锁定并读取模型部署行（`FOR UPDATE`），供串行的凭据挂载使用。
	 * @param tx - 事务句柄
	 * @param modelId - LiteLLM_ProxyModelTable.model_id
	 */
	async lockRowInTx(tx: ModelTransaction, modelId: string): Promise<ModelRow | null> {
		const locked = await tx.select().from(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId)).limit(1).for("update");
		return locked.at(0) ?? null;
	}

	/**
	 * 在事务内更新模型部署行；调用方在事务提交后调用 `invalidateCache` 让副本跟上。
	 * @param tx - 事务句柄
	 * @param modelId - LiteLLM_ProxyModelTable.model_id
	 * @param values - 待更新列
	 */
	async updateInTx(tx: ModelTransaction, modelId: string, values: ModelUpdateValues): Promise<ModelRow | null> {
		const updated = await tx
			.update(LiteLLM_ProxyModelTable)
			.set(values)
			.where(eq(LiteLLM_ProxyModelTable.model_id, modelId))
			.returning();
		return updated.at(0) ?? null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
