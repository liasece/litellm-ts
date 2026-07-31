import { CredentialRuntimeAccessor } from "./CredentialRuntimeAccessor";
import { CredentialSecretBox } from "./CredentialSecretBox";
import {
	CredentialNameImmutableError,
	CredentialReferencedError,
	CredentialService,
	type CredentialRepositoryPort,
	type StoredCredential,
} from "./CredentialService";

class FakeRepository implements CredentialRepositoryPort {
	readonly rows = new Map<string, StoredCredential>();
	lastPatch: Partial<StoredCredential> | undefined;
	referenced = false;

	async list(): Promise<StoredCredential[]> {
		return [...this.rows.values()];
	}

	async create(credential: StoredCredential): Promise<StoredCredential> {
		this.rows.set(credential.credential_name, credential);
		return credential;
	}

	async findByName(name: string): Promise<StoredCredential | null> {
		return this.rows.get(name) ?? null;
	}

	async patch(name: string, patch: Partial<StoredCredential>): Promise<StoredCredential | null> {
		this.lastPatch = patch;
		const current = this.rows.get(name);
		if (current === undefined) {
			return null;
		}
		const next = { ...current, ...patch };
		this.rows.set(name, next);
		return next;
	}

	async deleteByName(name: string): Promise<boolean> {
		return this.rows.delete(name);
	}

	async isReferenced(): Promise<boolean> {
		return this.referenced;
	}
}

function makeService(repository = new FakeRepository()) {
	const accessor = new CredentialRuntimeAccessor();
	return { repository: repository, accessor: accessor, service: new CredentialService(repository, accessor) };
}

describe("CredentialService", () => {
	it("管理读取返回完整 Credential 值", async () => {
		const { service } = makeService();
		await service.create({ credential_name: "openai", credential_values: { short: "a", long: "sk-secret-value" } }, "user-a");

		expect((await service.getByName("openai"))?.credential_values).toEqual({ short: "a", long: "sk-secret-value" });
	});

	it("无需加密 key 即可加载数据库明文 Credential", async () => {
		const current = makeService();
		current.repository.rows.set("stored", {
			credential_name: "stored",
			credential_values: { api_key: "sk-stored", regions: ["us-east-1"] },
			credential_info: {},
			created_by: "user-a",
			updated_by: "user-a",
		});

		await expect(current.service.load()).resolves.toBeUndefined();
		expect(current.accessor.getValues("stored")).toEqual({ api_key: "sk-stored", regions: ["us-east-1"] });
		expect((await current.service.getByName("stored"))?.credential_values).toEqual({
			api_key: "sk-stored",
			regions: ["us-east-1"],
		});
	});

	it("load 使用旧密钥将 SecretBox 字符串和值信封一次性改写为数据库明文", async () => {
		const repository = new FakeRepository();
		const secretBox = new CredentialSecretBox("legacy-key");
		repository.rows.set("legacy", {
			credential_name: "legacy",
			credential_values: {
				api_key: secretBox.encrypt("sk-legacy"),
				regions: secretBox.encrypt(JSON.stringify({ __litellm_ts_encrypted_json: ["us-east-1"] })),
				already_plain: "plain-value",
			},
			credential_info: {},
			created_by: "user-a",
			updated_by: "user-a",
		});
		const accessor = new CredentialRuntimeAccessor();
		const service = new CredentialService(repository, accessor, secretBox);

		await service.load();

		expect(repository.rows.get("legacy")?.credential_values).toEqual({
			api_key: "sk-legacy",
			regions: ["us-east-1"],
			already_plain: "plain-value",
		});
		expect(accessor.getValues("legacy")).toEqual(repository.rows.get("legacy")?.credential_values);
	});

	it("patch 仅修改请求字段，保留未提供明文值，null 删除 value，info 按字段合并", async () => {
		const { repository, accessor, service } = makeService();
		await service.create(
			{
				credential_name: "openai",
				credential_values: { api_key: "sk-old", base_url: "https://old.example", api_version: "v1" },
				credential_info: { description: "prod", required: true },
			},
			"user-a",
		);
		const original = { ...repository.rows.get("openai")!.credential_values };

		await service.patch(
			"openai",
			{ credential_values: { api_key: "sk-new", base_url: null }, credential_info: { description: "next" } },
			"user-b",
		);

		expect(repository.lastPatch?.credential_values).toEqual({ api_key: "sk-new", api_version: original.api_version });
		expect(repository.lastPatch?.credential_values?.api_key).not.toBe(original.api_key);
		expect(repository.rows.get("openai")?.credential_values).toEqual(repository.lastPatch?.credential_values);
		expect(repository.rows.get("openai")?.credential_info).toEqual({ description: "next", required: true });
		expect(accessor.getValues("openai")).toEqual({ api_key: "sk-new", api_version: "v1" });
	});

	it("字符串与非字符串 credential 值均按原始 JSON 类型明文落库", async () => {
		const { repository, accessor, service } = makeService();
		const values = { api_key: "sk-secret", api_version: 2, use_azure_ad: true, regions: ["us-east-1"] };

		await service.create({ credential_name: "azure", credential_values: values }, "user-a");

		expect(repository.rows.get("azure")?.credential_values).toEqual(values);
		expect(accessor.getValues("azure")).toEqual(values);
	});

	it("patch 禁止重命名，delete 有引用时返回可映射 409 的错误", async () => {
		const { repository, service } = makeService();
		await service.create({ credential_name: "openai", credential_values: { api_key: "sk" } }, "user-a");

		await expect(service.patch("openai", { credential_name: "other" }, "user-b")).rejects.toBeInstanceOf(CredentialNameImmutableError);
		repository.referenced = true;
		await expect(service.delete("openai")).rejects.toMatchObject({ name: CredentialReferencedError.name, statusCode: 409 });
		expect(repository.rows.has("openai")).toBe(true);
	});
});
