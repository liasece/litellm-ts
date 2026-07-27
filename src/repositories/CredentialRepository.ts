import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_CredentialsTable } from "../db/schema/credentials";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import type { AttachedCredentialResult, CredentialAttachmentFactory } from "../credentials/CredentialService";

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

/** 复用 LiteLLM_CredentialsTable 的凭据持久层。 */
export class CredentialRepository extends BaseRepository {
	constructor(db: DrizzleDb) {
		super(db);
	}

	/** 返回全部持久化 Credential 记录。 */
	async list(): Promise<CredentialRecord[]> {
		const rows = await this._db.select().from(LiteLLM_CredentialsTable);
		return rows.map((row) => this._toRecord(row));
	}

	/**
	 * 按唯一名称读取 Credential，不存在时返回 null。
	 * @param credentialName
	 */
	async findByName(credentialName: string): Promise<CredentialRecord | null> {
		const rows = await this._db
			.select()
			.from(LiteLLM_CredentialsTable)
			.where(eq(LiteLLM_CredentialsTable.credential_name, credentialName))
			.limit(1);
		const row = rows.at(0);
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
			return row === undefined ? null : this._toRecord(row);
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
		return deleted.length > 0;
	}

	/**
	 * 在单个事务中原子删除未被模型引用的 Credential：
	 * 先锁定 Credential 行，再在引用检查与删除之间不释放锁，避免检查时窗口产生悬空引用。
	 * @param credentialName
	 */
	async deleteIfUnreferenced(credentialName: string): Promise<"deleted" | "not_found" | "referenced"> {
		return await this._db.transaction(async (tx) => {
			const locked = await tx.execute(
				sql`SELECT credential_name FROM "LiteLLM_CredentialsTable" WHERE credential_name = ${credentialName} FOR UPDATE`,
			);
			if (locked.rows.length === 0) {
				return "not_found";
			}
			const models = await tx.select().from(LiteLLM_ProxyModelTable);
			const referenced = models.some((model) => this._asRecord(model.litellm_params).litellm_credential_name === credentialName);
			if (referenced) {
				return "referenced";
			}
			await tx.delete(LiteLLM_CredentialsTable).where(eq(LiteLLM_CredentialsTable.credential_name, credentialName));
			return "deleted";
		});
	}

	/**
	 * @param credentialName
	 */
	async isReferenced(credentialName: string): Promise<boolean> {
		const models = await this._db.select().from(LiteLLM_ProxyModelTable);
		return models.some((model) => this._asRecord(model.litellm_params).litellm_credential_name === credentialName);
	}

	/**
	 * @param modelId
	 */
	async findModelById(modelId: string): Promise<CredentialModelRecord | null> {
		const rows = await this._db.select().from(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId)).limit(1);
		const row = rows.at(0);
		if (row === undefined) {
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
			return await this._db.transaction(async (tx) => {
				const locked = await tx.execute(sql`SELECT model_id FROM "LiteLLM_ProxyModelTable" WHERE model_id = ${modelId} FOR UPDATE`);
				if (locked.rows.length === 0) {
					return null;
				}
				const rows = await tx.select().from(LiteLLM_ProxyModelTable).where(eq(LiteLLM_ProxyModelTable.model_id, modelId)).limit(1);
				const model = rows.at(0);
				if (model === undefined) {
					throw new Error("Locked model is unavailable");
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
				const updated = await tx
					.update(LiteLLM_ProxyModelTable)
					.set({ litellm_params: currentParams, updated_by: credential.updated_by, updated_at: new Date() })
					.where(eq(LiteLLM_ProxyModelTable.model_id, modelId))
					.returning();
				if (updated.length === 0) {
					throw new Error("Locked model update did not return a row");
				}
				return {
					credential: this._toRecord(insertedCredential),
					model: { ...modelRecord, litellm_params: currentParams, updated_by: credential.updated_by },
				};
			});
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

	private _toRecord(row: typeof LiteLLM_CredentialsTable.$inferSelect): CredentialRecord {
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
