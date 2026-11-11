import { randomUUID } from "node:crypto";
import { ApiError } from "../core/api/ApiError";
import { CredentialSecretBox } from "../credentials/CredentialSecretBox";
import type { ConfigRepository } from "../repositories/ConfigRepository";

/** Sources that use a dashboard-managed API key. */
export type KeySubscription = "commandcode" | "opencode-go";
/** Account metadata safe to return to an administrator. */
export interface SavedSubscriptionKey {
	/** Stable account identifier across key rotations. */
	readonly id: string;
	/** Account source. */
	readonly provider: KeySubscription;
	/** Administrator-selected label. */
	readonly label: string;
}
/** Decrypted account record used only to project runtime configuration. */
export interface SubscriptionKey extends SavedSubscriptionKey {
	/** Subscription API key. */
	readonly key: string;
}
const CONFIG = "subscription_account_keys";

/** Native account keys have no deployment-level secret. Legacy YAML and environment accounts retain their existing owner. */
export class SubscriptionAccountKeys {
	private readonly _box: CredentialSecretBox | undefined;
	private _records: SubscriptionKey[] = [];
	private _loaded?: Promise<void>;

	constructor(
		private readonly _repository: ConfigRepository,
		key?: string,
	) {
		if (key) {
			this._box = new CredentialSecretBox(key);
		}
	}

	/** Read the current encrypted records once, retrying a failed read. */
	load(): Promise<void> {
		this._loaded ??= this._read().catch((err: unknown) => {
			this._loaded = undefined;
			throw err;
		});
		return this._loaded;
	}

	private async _read(): Promise<void> {
		const stored = await this._repository.getParam(CONFIG);
		if (!stored) {
			return;
		}
		if (!this._box || stored["version"] !== 1 || typeof stored["ciphertext"] !== "string") {
			throw ApiError.unavailable("无法读取订阅凭据");
		}
		const records: unknown = JSON.parse(this._box.decrypt(stored["ciphertext"]));
		if (!Array.isArray(records) || !records.every(isKeyRecord)) {
			throw ApiError.unavailable("订阅凭据格式无效");
		}
		this._records = records;
	}

	/** Decrypted records for the private runtime projection. */
	get records(): readonly SubscriptionKey[] {
		return this._records;
	}

	/** Return only fields exposed by the management API. */
	list(): SavedSubscriptionKey[] {
		return this._records.map(({ id, provider, label }) => ({ id: id, provider: provider, label: label }));
	}

	/**
	 * The runtime serializes mutations with the projection to auth files. Only publish a change after its durable write.
	 * @param provider
	 * @param id
	 * @param label
	 * @param key
	 */
	async save(provider: KeySubscription, id: string | undefined, label: string, key?: string): Promise<SubscriptionKey> {
		await this.load();
		const prev = id ? this._records.find((r) => r.id === id && r.provider === provider) : undefined;
		if (id && !prev) {
			throw ApiError.notFound("订阅账号不存在");
		}
		const secret = key?.trim() || prev?.key;
		if (!secret || !label.trim() || label.length > 256 || secret.length > 8192) {
			throw ApiError.badRequest("请填写有效的订阅账号名称和密钥");
		}
		const duplicate = this._records.find((r) => r.provider === provider && r.key === secret && r.id !== id);
		if (duplicate) {
			if (!id && duplicate.label === label.trim()) {
				return duplicate;
			}
			throw ApiError.conflict("订阅账号已存在");
		}
		const entry = { id: prev?.id ?? randomUUID(), provider: provider, label: label.trim(), key: secret };
		const next = prev ? this._records.map((r) => (r.id === id ? entry : r)) : [...this._records, entry];
		await this._persist(next);
		return entry;
	}

	/**
	 * 移除一条已保存的 key 记录；用于管理面彻底删除。
	 * @param provider - 来源
	 * @param id - 记录 ID
	 */
	async remove(provider: KeySubscription, id: string): Promise<void> {
		await this.load();
		if (!this._records.some((record) => record.provider === provider && record.id === id)) {
			throw ApiError.notFound("订阅账号不存在");
		}
		await this._persist(this._records.filter((record) => !(record.provider === provider && record.id === id)));
	}

	private async _persist(records: SubscriptionKey[]): Promise<void> {
		if (!this._box) {
			throw ApiError.unavailable("请先设置 LITELLM_SALT_KEY 或 master key 以保存订阅凭据");
		}
		await this._repository.upsertParam(CONFIG, { version: 1, ciphertext: this._box.encrypt(JSON.stringify(records)) });
		this._records = records;
	}
}

function isKeyRecord(value: unknown): value is SubscriptionKey {
	if (!value || typeof value !== "object") {
		return false;
	}
	const row = value as Record<string, unknown>;
	return (
		typeof row["id"] === "string" &&
		/^[0-9a-f-]{36}$/.test(row["id"]) &&
		(row["provider"] === "opencode-go" || row["provider"] === "commandcode") &&
		typeof row["label"] === "string" &&
		typeof row["key"] === "string" &&
		row["key"].length > 0
	);
}
