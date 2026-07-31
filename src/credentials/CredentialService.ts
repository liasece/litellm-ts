import providerCreateFieldsJson from "../data/provider_create_fields.json";
import type { Deployment } from "../types/router";
import type { CredentialRuntimeAccessor, RuntimeCredential } from "./CredentialRuntimeAccessor";
import type { CredentialSecretBox } from "./CredentialSecretBox";

export const MASKED_CREDENTIAL_VALUE = "********";

/** 数据库明文存储的 Credential。 */
export interface StoredCredential {
	/**
	 *
	 */
	readonly credential_name: string;
	/**
	 *
	 */
	readonly credential_values: Record<string, unknown>;
	/**
	 *
	 */
	readonly credential_info: Record<string, unknown> | null;
	/**
	 *
	 */
	readonly created_by: string;
	/**
	 *
	 */
	readonly updated_by: string;
}

/** Credential 关联的模型记录。 */
export interface CredentialModelRecord {
	/**
	 *
	 */
	readonly model_id: string;
	/**
	 *
	 */
	readonly model_name: string;
	/**
	 *
	 */
	readonly litellm_params: Record<string, unknown>;
	/**
	 *
	 */
	readonly model_info: Record<string, unknown> | null;
	/**
	 *
	 */
	readonly created_by: string;
	/**
	 *
	 */
	readonly updated_by: string;
}

/** 普通 Credential 创建输入。 */
export interface CredentialInput {
	/**
	 *
	 */
	readonly credential_name: string;
	/**
	 *
	 */
	readonly credential_values: Record<string, unknown>;
	/**
	 *
	 */
	readonly credential_info?: Record<string, unknown>;
}

/** 从模型内联字段提取 Credential 的输入。 */
export interface CredentialAttachInput {
	/**
	 *
	 */
	readonly credential_name: string;
	/**
	 *
	 */
	readonly model_id: string;
	/**
	 *
	 */
	readonly credential_info?: Record<string, unknown>;
}

/** Credential 部分更新输入。 */
export interface CredentialPatch {
	/**
	 *
	 */
	readonly credential_name?: string;
	/**
	 *
	 */
	readonly credential_values?: Record<string, unknown | null>;
	/**
	 *
	 */
	readonly credential_info?: Record<string, unknown>;
}

/** 管理 API 返回的完整 Credential。 */
export interface CredentialView {
	/**
	 *
	 */
	readonly credential_name: string;
	/**
	 *
	 */
	readonly credential_values: Record<string, unknown>;
	/**
	 *
	 */
	readonly credential_info: Record<string, unknown>;
}

/** 事务内根据最新模型参数生成待存 Credential。 */
export type CredentialAttachmentFactory = (litellmParams: Record<string, unknown>) => StoredCredential | null;

/** Credential 与模型原子关联的结果；credential=null 表示模型存在但无可提取字段。 */
export interface AttachedCredentialResult {
	/**
	 *
	 */
	readonly credential: StoredCredential | null;
	/**
	 *
	 */
	readonly model: CredentialModelRecord;
}

/** Credential 持久层边界。 */
export interface CredentialRepositoryPort {
	/**
	 *
	 */
	list(): Promise<StoredCredential[]>;
	/**
	 *
	 */
	create(credential: StoredCredential): Promise<StoredCredential>;
	/**
	 *
	 */
	findByName(credentialName: string): Promise<StoredCredential | null>;
	/**
	 *
	 */
	patch(credentialName: string, patch: Partial<StoredCredential>): Promise<StoredCredential | null>;
	/**
	 *
	 */
	deleteByName(credentialName: string): Promise<boolean>;
	/**
	 * 原子删除未被模型引用的 Credential；可选能力，存在时优先于 isReferenced+deleteByName。
	 * @param credentialName
	 */
	deleteIfUnreferenced?(credentialName: string): Promise<"deleted" | "not_found" | "referenced">;
	/**
	 *
	 */
	isReferenced(credentialName: string): Promise<boolean>;
	/**
	 *
	 */
	createAndAttachToModel?(modelId: string, createCredential: CredentialAttachmentFactory): Promise<AttachedCredentialResult | null>;
}

/** 可由 HTTP 层稳定映射的凭据领域错误。 */
export class CredentialServiceError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
		readonly code: string,
	) {
		super(message);
		this.name = new.target.name;
	}
}

/** Credential 名称不可通过 PATCH 修改。 */
export class CredentialNameImmutableError extends CredentialServiceError {
	constructor() {
		super("credential_name cannot be changed", 400, "CREDENTIAL_NAME_IMMUTABLE");
	}
}

/** Credential 名称已存在。 */
export class CredentialAlreadyExistsError extends CredentialServiceError {
	constructor() {
		super("Credential already exists", 409, "CREDENTIAL_ALREADY_EXISTS");
	}
}

/** Credential 仍被模型引用。 */
export class CredentialReferencedError extends CredentialServiceError {
	constructor() {
		super("Credential is referenced by one or more models", 409, "CREDENTIAL_REFERENCED");
	}
}

/** Router 中不存在指定 deployment ID。 */
export class CredentialModelNotFoundError extends CredentialServiceError {
	constructor() {
		super("Model deployment not found", 404, "CREDENTIAL_MODEL_NOT_FOUND");
	}
}

/** 模型 Credential 引用或内联字段无法解析。 */
export class CredentialModelResolutionError extends CredentialServiceError {
	constructor(message: string, statusCode: 404 | 409) {
		super(message, statusCode, "CREDENTIAL_MODEL_RESOLUTION_FAILED");
	}
}

interface ProviderCredentialMetadata {
	readonly litellm_provider: string;
	readonly credential_fields: ReadonlyArray<{ readonly key: string }>;
}

interface ExtractedInlineCredential {
	readonly provider: string;
	readonly metadataFound: boolean;
	readonly values: Record<string, unknown>;
}

const PROVIDER_CREDENTIAL_METADATA = providerCreateFieldsJson as readonly ProviderCredentialMetadata[];
const LEGACY_NON_STRING_ENVELOPE = "__litellm_ts_encrypted_json";

/** 协调数据库与运行时 Credential；管理 API 按产品约定返回完整字段。 */
export class CredentialService {
	constructor(
		private readonly _repository: CredentialRepositoryPort,
		/**
		 * 仅保留给独立单元测试和非数据库 Router 使用。生产容器不注入该参数，
		 * 推理请求改由 DatabaseRuntimeConfigService 每请求读取数据库。
		 */
		private readonly _runtimeAccessor?: CredentialRuntimeAccessor,
		private readonly _legacySecretBox: CredentialSecretBox | null = null,
	) {}

	/** 启动时将可识别的旧 SecretBox 值迁移为数据库明文。 */
	async load(): Promise<void> {
		const storedCredentials = await this._repository.list();
		const migratedCredentials: StoredCredential[] = [];
		for (const credential of storedCredentials) {
			migratedCredentials.push(await this._migrateLegacyCredential(credential));
		}
		this._runtimeAccessor?.replaceAll(migratedCredentials.map((credential) => this._toRuntime(credential)));
	}

	/**
	 * 创建普通 Credential。
	 * @param credential
	 * @param actorId
	 */
	async create(credential: CredentialInput, actorId: string): Promise<void> {
		this._validateName(credential.credential_name);
		if ((await this._repository.findByName(credential.credential_name)) !== null) {
			throw new CredentialAlreadyExistsError();
		}
		try {
			const stored = await this._repository.create({
				credential_name: credential.credential_name,
				credential_values: structuredClone(credential.credential_values),
				credential_info: structuredClone(credential.credential_info ?? {}),
				created_by: actorId,
				updated_by: actorId,
			});
			this._runtimeAccessor?.upsert(this._toRuntime(stored));
		} catch (error) {
			this._rethrowConflict(error);
		}
	}

	/**
	 * 在单个数据库事务中从模型最新 inline 参数提取并关联 Credential。
	 * @param credential
	 * @param actorId
	 */
	async createFromModel(credential: CredentialAttachInput, actorId: string): Promise<CredentialModelRecord> {
		this._validateName(credential.credential_name);
		if ((await this._repository.findByName(credential.credential_name)) !== null) {
			throw new CredentialAlreadyExistsError();
		}
		if (this._repository.createAndAttachToModel === undefined) {
			throw new CredentialModelResolutionError("Model credential attachment is unavailable", 409);
		}
		try {
			const attachmentResult = await this._repository.createAndAttachToModel(credential.model_id, (litellmParams) => {
				const extracted = this._extractInlineCredential(litellmParams);
				if (!extracted.metadataFound || Object.keys(extracted.values).length === 0) {
					return null;
				}
				return {
					credential_name: credential.credential_name,
					credential_values: structuredClone(extracted.values),
					credential_info: structuredClone({
						custom_llm_provider: extracted.provider,
						...(credential.credential_info ?? {}),
					}),
					created_by: actorId,
					updated_by: actorId,
				};
			});
			if (attachmentResult === null) {
				throw new CredentialModelNotFoundError();
			}
			if (attachmentResult.credential === null) {
				throw new CredentialModelResolutionError("Model has no recognized inline credential fields", 409);
			}
			this._runtimeAccessor?.upsert(this._toRuntime(attachmentResult.credential));
			return attachmentResult.model;
		} catch (error) {
			this._rethrowConflict(error);
		}
	}

	/** 返回全部 Credential 的完整字段。 */
	async list(): Promise<CredentialView[]> {
		const storedCredentials = await this._repository.list();
		if (storedCredentials.length === 0) {
			return [];
		}
		return storedCredentials.map((credential) => this._toView(this._toRuntime(credential)));
	}

	/**
	 * 按名称返回完整 Credential。
	 * @param credentialName
	 */
	async getByName(credentialName: string): Promise<CredentialView | null> {
		const stored = await this._repository.findByName(credentialName);
		if (stored === null) {
			return null;
		}
		return this._toView(this._toRuntime(stored));
	}

	/**
	 * 按 Router deployment ID 返回命名引用或 inline Credential 的完整字段。
	 * @param modelId
	 * @param deployment
	 */
	async getByModel(modelId: string, deployment: Deployment | null): Promise<CredentialView> {
		if (deployment === null) {
			throw new CredentialModelNotFoundError();
		}
		const credentialName = deployment.litellm_params["litellm_credential_name"];
		if (typeof credentialName === "string" && credentialName.length > 0) {
			const found = await this.getByName(credentialName);
			if (found === null) {
				throw new CredentialModelResolutionError("Model references a missing Credential", 404);
			}
			return found;
		}
		const extracted = this._extractInlineCredential(deployment.litellm_params);
		if (!extracted.metadataFound) {
			throw new CredentialModelResolutionError(`Provider credential fields are unavailable: ${extracted.provider}`, 409);
		}
		if (Object.keys(extracted.values).length === 0) {
			throw new CredentialModelResolutionError("Model has no recognized inline credential fields", 409);
		}
		return this._toView({
			credential_name: modelId,
			credential_values: extracted.values,
			credential_info: { custom_llm_provider: extracted.provider },
		});
	}

	/**
	 * 部分更新实际字段；固定掩码不得作为新值提交。
	 * @param credentialName
	 * @param patch
	 * @param actorId
	 */
	async patch(credentialName: string, patch: CredentialPatch, actorId: string): Promise<boolean> {
		if (patch.credential_name !== undefined) {
			throw new CredentialNameImmutableError();
		}
		const current = await this._repository.findByName(credentialName);
		if (current === null) {
			return false;
		}
		const nextValues = structuredClone(current.credential_values);
		for (const [key, value] of Object.entries(patch.credential_values ?? {})) {
			if (value === MASKED_CREDENTIAL_VALUE) {
				throw new CredentialServiceError("Masked credential values cannot be submitted", 400, "MASKED_CREDENTIAL_VALUE");
			}
			if (value === null) {
				delete nextValues[key];
			} else {
				nextValues[key] = structuredClone(value);
			}
		}
		const nextInfo = structuredClone({ ...(current.credential_info ?? {}), ...(patch.credential_info ?? {}) });
		const updated = await this._repository.patch(credentialName, {
			credential_values: nextValues,
			credential_info: nextInfo,
			updated_by: actorId,
		});
		if (updated === null) {
			return false;
		}
		this._runtimeAccessor?.upsert(this._toRuntime(updated));
		return true;
	}

	/**
	 * 删除未被模型引用的 Credential；引用检查与删除在同一数据库事务中原子完成。
	 * @param credentialName
	 */
	async delete(credentialName: string): Promise<boolean> {
		if (this._repository.deleteIfUnreferenced !== undefined) {
			const deleteResult = await this._repository.deleteIfUnreferenced(credentialName);
			if (deleteResult === "referenced") {
				throw new CredentialReferencedError();
			}
			if (deleteResult === "deleted") {
				this._runtimeAccessor?.remove(credentialName);
				return true;
			}
			return false;
		}
		if (await this._repository.isReferenced(credentialName)) {
			throw new CredentialReferencedError();
		}
		const deleted = await this._repository.deleteByName(credentialName);
		if (deleted) {
			this._runtimeAccessor?.remove(credentialName);
		}
		return deleted;
	}

	private _validateName(credentialName: string): void {
		if (credentialName.trim().length === 0) {
			throw new CredentialServiceError("credential_name is required", 400, "CREDENTIAL_NAME_REQUIRED");
		}
	}

	private async _migrateLegacyCredential(stored: StoredCredential): Promise<StoredCredential> {
		if (this._legacySecretBox === null) {
			return stored;
		}
		const values = structuredClone(stored.credential_values);
		let migrated = false;
		for (const [key, value] of Object.entries(values)) {
			if (typeof value !== "string") {
				continue;
			}
			try {
				values[key] = this._restoreLegacyValue(this._legacySecretBox.decrypt(value));
				migrated = true;
			} catch {
				// 无法通过旧密钥认证的字符串已经是明文，保持原值。
			}
		}
		if (!migrated) {
			return stored;
		}
		const updated = await this._repository.patch(stored.credential_name, {
			credential_values: values,
			updated_by: stored.updated_by,
		});
		if (updated === null) {
			throw new Error(`Credential disappeared during plaintext migration: ${stored.credential_name}`);
		}
		return updated;
	}

	private _restoreLegacyValue(plaintext: string): unknown {
		try {
			const parsed: unknown = JSON.parse(plaintext);
			if (this._isRecord(parsed) && Object.keys(parsed).length === 1 && LEGACY_NON_STRING_ENVELOPE in parsed) {
				return parsed[LEGACY_NON_STRING_ENVELOPE];
			}
		} catch {
			// 普通字符串不是 JSON，直接返回。
		}
		return plaintext;
	}

	private _toRuntime(stored: StoredCredential): RuntimeCredential {
		return {
			credential_name: stored.credential_name,
			credential_values: structuredClone(stored.credential_values),
			credential_info: structuredClone(stored.credential_info ?? {}),
		};
	}

	private _toView(credential: RuntimeCredential): CredentialView {
		return {
			credential_name: credential.credential_name,
			credential_values: structuredClone(credential.credential_values),
			credential_info: structuredClone(credential.credential_info),
		};
	}

	private _extractInlineCredential(litellmParams: Record<string, unknown>): ExtractedInlineCredential {
		const explicitProvider = litellmParams["custom_llm_provider"];
		const model = litellmParams["model"];
		const provider =
			typeof explicitProvider === "string" && explicitProvider.length > 0
				? explicitProvider
				: typeof model === "string"
					? (model.split("/", 1)[0] ?? "")
					: "";
		const metadata = PROVIDER_CREDENTIAL_METADATA.find(
			(candidate) => candidate.litellm_provider.toLowerCase() === provider.toLowerCase(),
		);
		if (metadata === undefined) {
			return { provider: provider, metadataFound: false, values: {} };
		}
		const values: Record<string, unknown> = {};
		for (const field of metadata.credential_fields) {
			const value = litellmParams[field.key];
			if (value !== undefined && value !== null) {
				values[field.key] = value;
			}
		}
		return { provider: provider, metadataFound: true, values: values };
	}

	private _rethrowConflict(error: unknown): never {
		if (this._isRecord(error) && error["code"] === "CREDENTIAL_NAME_CONFLICT") {
			throw new CredentialAlreadyExistsError();
		}
		throw error;
	}

	private _isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null;
	}
}
