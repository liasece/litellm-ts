import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_CredentialsTable } from "../db/schema/credentials";
import { revisionCounterFor, TableCache } from "./internal/TableCache";
import { modelRepositoryFor } from "./ModelRepository";
import type { AttachedCredentialResult, CredentialAttachmentFactory } from "../credentials/CredentialService";

/** 数据库明文存储的 Credential 行。 */
export type CredentialRow = typeof LiteLLM_CredentialsTable.$inferSelect;

/** 数据库明文存储的 Credential。 */
export interface CredentialRecord {
	/** 全局唯一的 Credential 名称。 */
	readonly credential_name: string;
	/** 按原始 JSON 类型保存的明文值。 */
	readonly credential_values: Record<string, unknown>;
	/** Provider 等非秘密元数据。 */
	readonly credential_info: Record<string, unknown> | null;
	/** 创建者标识。 */
	readonly created_by: string;
	/** 最近更新者标识。 */
	readonly updated_by: string;
}

/** Credential 所引用的模型记录。 */
export interface CredentialModelRecord {
	/** 模型部署 ID。 */
	readonly model_id: string;
	/** 对外模型名称。 */
	readonly model_name: string;
	/** 已移除内联秘密并写入 Credential 引用的模型参数。 */
	readonly litellm_params: Record<string, unknown>;
	/** 模型展示及能力元数据。 */
	readonly model_info: Record<string, unknown> | null;
	/** 模型创建者标识。 */
	readonly created_by: string;
	/** 模型最近更新者标识。 */
	readonly updated_by: string;
}

/** 数据库唯一约束冲突，不携带数据库 detail 或秘密值。 */
export class CredentialRepositoryConflictError extends Error {
	readonly code = "CREDENTIAL_NAME_CONFLICT";

	constructor() {
		super("Credential name already exists");
		this.name = "CredentialRepositoryConflictError";
	}
}

const caches = new WeakMap<object, TableCache<CredentialRow>>();
const repositories = new WeakMap<object, CredentialRepository>();

function cacheFor(db: DrizzleDb): TableCache<CredentialRow> {
	const key = db as unknown as object;
	const existing = caches.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new TableCache<CredentialRow>(() => db.select().from(LiteLLM_CredentialsTable), revisionCounterFor(key));
	caches.set(key, created);
	return created;
}

/**
 * 取得与数据库连接绑定的凭据仓库；同一连接上的所有调用方共享同一份副本。
 * @param db - Drizzle 数据库实例
 */
export function credentialRepositoryFor(db: DrizzleDb): CredentialRepository {
	const key = db as unknown as object;
	const existing = repositories.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new CredentialRepository(db);
	repositories.set(key, created);
	return created;
}

/** 复用 LiteLLM_CredentialsTable 的凭据持久层。 */
export class CredentialRepository extends BaseRepository {
	private readonly _cache: TableCache<CredentialRow>;

	constructor(db: DrizzleDb) {
		super(db);
		this._cache = cacheFor(db);
	}

	/** 当前副本版本号，供请求级快照判重。 */
	revision(): number {
		return this._cache.revision();
	}

	/** 读取全部凭据行；返回共享副本，调用方只读。 */
	async snapshotRows(): Promise<CredentialRow[]> {
		return await this._cache.rows();
	}

	/** 外部直接改库后强制重新装载；应用内写路径不需要调用。 */
	invalidateCache(): void {
		this._cache.invalidate();
	}

	/** 返回全部持久化 Credential 记录。 */
	async list(): Promise<CredentialRecord[]> {
		const rows = await this._cache.rows();
		return rows.map((row) => this._toRecord(row));
	}

	/**
	 * 按唯一名称读取 Credential，不存在时返回 null。
	 * @param credentialName
	 */
	async findByName(credentialName: string): Promise<CredentialRecord | null> {
		const rows = await this._cache.rows();
		const row = rows.find((candidate) => candidate.credential_name === credentialName);
		return row === undefined ? null : this._toRecord(row);
	}

	/**
	 * 新建 Credential，并返回数据库实际写入的记录。
	 * @param credential
	 */
	async create(credential: CredentialRecord): Promise<CredentialRecord> {
		try {
			const inserted = await this._db.insert(LiteLLM_CredentialsTable).values(this._toInsert(credential)).returning();
			const row = inserted.at(0);
			if (row === undefined) {
				throw new Error("Credential insert did not return a row");
			}
			this._cache.invalidate();
			return this._toRecord(row);
		} catch (error) {
			this._rethrowConflict(error);
		}
	}

	/**
	 * @param credentialName
	 * @param patch
	 */
	async patch(credentialName: string, patch: Partial<CredentialRecord>): Promise<CredentialRecord | null> {
		try {
			const updated = await this._db
				.update(LiteLLM_CredentialsTable)
				.set({
					...(patch.credential_values === undefined ? {} : { credential_values: patch.credential_values }),
					...(patch.credential_info === undefined ? {} : { credential_info: patch.credential_info }),
					...(patch.updated_by === undefined ? {} : { updated_by: patch.updated_by }),
					updated_at: new Date(),
				})
				.where(eq(LiteLLM_CredentialsTable.credential_name, credentialName))
				.returning();
			const row = updated.at(0);
			if (row === undefined) {
				return null;
			}
			this._cache.invalidate();
			return this._toRecord(row);
		} catch (error) {
			this._rethrowConflict(error);
		}
	}

	/**
	 * @param credentialName
	 */
	async deleteByName(credentialName: string): Promise<boolean> {
		const deleted = await this._db
			.delete(LiteLLM_CredentialsTable)
			.where(eq(LiteLLM_CredentialsTable.credential_name, credentialName))
			.returning({ credential_name: LiteLLM_CredentialsTable.credential_name });
		if (deleted.length > 0) {
			this._cache.invalidate();
			return true;
		}
		return false;
	}

	/**
	 * 在单个事务中原子删除未被模型引用的 Credential：
	 * 先锁定 Credential 行，再在引用检查与删除之间不释放锁，避免检查时窗口产生悬空引用。
	 * @param credentialName
	 */
	async deleteIfUnreferenced(credentialName: string): Promise<"deleted" | "not_found" | "referenced"> {
		const modelRepository = modelRepositoryFor(this._db);
		const result = await this._db.transaction(async (tx) => {
			const locked = await tx.execute(
				sql`SELECT credential_name FROM "LiteLLM_CredentialsTable" WHERE credential_name = ${credentialName} FOR UPDATE`,
			);
			if (locked.rows.length === 0) {
				return "not_found" as const;
			}
			if (await modelRepository.isCredentialReferenced(credentialName, tx)) {
				return "referenced" as const;
			}
			await tx.delete(LiteLLM_CredentialsTable).where(eq(LiteLLM_CredentialsTable.credential_name, credentialName));
			return "deleted" as const;
		});
		if (result === "deleted") {
			this._cache.invalidate();
		}
		return result;
	}

	/**
	 * @param credentialName
	 */
	async isReferenced(credentialName: string): Promise<boolean> {
		return await modelRepositoryFor(this._db).isCredentialReferenced(credentialName);
	}

	/**
	 * @param modelId
	 */
	async findModelById(modelId: string): Promise<CredentialModelRecord | null> {
		const row = await modelRepositoryFor(this._db).findById(modelId);
		if (row === null) {
			return null;
		}
		return {
			model_id: row.model_id,
			model_name: row.model_name,
			litellm_params: { ...this._asRecord(row.litellm_params) },
			model_info: this._nullableRecord(row.model_info),
			created_by: row.created_by,
			updated_by: row.updated_by,
		};
	}

	/**
	 * 在同一事务中创建 Credential、写入模型引用并清除模型内联秘密。
	 * @param modelId
	 * @param createCredential
	 */
	async createAndAttachToModel(modelId: string, createCredential: CredentialAttachmentFactory): Promise<AttachedCredentialResult | null> {
		try {
			const modelRepository = modelRepositoryFor(this._db);
			const result = await this._db.transaction(async (tx) => {
				const model = await modelRepository.lockRowInTx(tx, modelId);
				if (model === null) {
					return null;
				}
				const currentParams = { ...this._asRecord(model.litellm_params) };
				const credential = createCredential(currentParams);
				const modelRecord: CredentialModelRecord = {
					model_id: model.model_id,
					model_name: model.model_name,
					litellm_params: currentParams,
					model_info: this._nullableRecord(model.model_info),
					created_by: model.created_by,
					updated_by: model.updated_by,
				};
				if (credential === null) {
					return { credential: null, model: modelRecord };
				}
				for (const fieldName of Object.keys(credential.credential_values)) {
					delete currentParams[fieldName];
				}
				currentParams.litellm_credential_name = credential.credential_name;
				const inserted = await tx.insert(LiteLLM_CredentialsTable).values(this._toInsert(credential)).returning();
				const insertedCredential = inserted.at(0);
				if (insertedCredential === undefined) {
					throw new Error("Credential insert did not return a row");
				}
				const updated = await modelRepository.updateInTx(tx, modelId, {
					litellm_params: currentParams,
					updated_by: credential.updated_by,
					updated_at: new Date(),
				});
				if (updated === null) {
					throw new Error("Locked model update did not return a row");
				}
				return {
					credential: this._toRecord(insertedCredential),
					model: { ...modelRecord, litellm_params: currentParams, updated_by: credential.updated_by },
				};
			});
			if (result !== null && result.credential !== null) {
				this._cache.invalidate();
				modelRepository.invalidateCache();
			}
			return result;
		} catch (error) {
			this._rethrowConflict(error);
		}
	}

	private _toInsert(credential: CredentialRecord): typeof LiteLLM_CredentialsTable.$inferInsert {
		return {
			credential_id: randomUUID(),
			credential_name: credential.credential_name,
			credential_values: credential.credential_values,
			credential_info: credential.credential_info,
			created_by: credential.created_by,
			updated_by: credential.updated_by,
		};
	}

	private _toRecord(row: CredentialRow): CredentialRecord {
		return {
			credential_name: row.credential_name,
			credential_values: { ...this._asRecord(row.credential_values) },
			credential_info: this._nullableRecord(row.credential_info),
			created_by: row.created_by,
			updated_by: row.updated_by,
		};
	}

	private _rethrowConflict(error: unknown): never {
		if (this._isRecord(error) && error.code === "23505") {
			throw new CredentialRepositoryConflictError();
		}
		throw error;
	}

	private _asRecord(value: unknown): Record<string, unknown> {
		return this._isRecord(value) ? value : {};
	}

	private _nullableRecord(value: unknown): Record<string, unknown> | null {
		return this._isRecord(value) ? { ...value } : null;
	}

	private _isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
}
