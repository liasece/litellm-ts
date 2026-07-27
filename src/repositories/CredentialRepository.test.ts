import { CredentialRepository, CredentialRepositoryConflictError } from "./CredentialRepository";

const stored = {
	credential_id: "credential-1",
	credential_name: "openai",
	credential_values: { api_key: "encrypted" },
	credential_info: { description: "prod" },
	created_at: new Date(),
	created_by: "user-a",
	updated_at: new Date(),
	updated_by: "user-a",
};

const model = {
	model_id: "model-1",
	model_name: "gpt",
	litellm_params: { model: "openai/gpt-4", api_key: "sk-secret" },
	model_info: { id: "model-1" },
	created_at: new Date(),
	created_by: "user-a",
	updated_at: new Date(),
	updated_by: "user-a",
};

describe("CredentialRepository", () => {
	it("create/patch/delete 以 returning 确认写入，并将零行映射为失败结果", async () => {
		const insertReturning = jest.fn().mockResolvedValue([stored]);
		const patchReturning = jest.fn().mockResolvedValue([stored]);
		const deleteReturning = jest.fn().mockResolvedValue([]);
		const db = {
			insert: jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue({ returning: insertReturning }) }),
			update: jest
				.fn()
				.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: patchReturning }) }) }),
			delete: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: deleteReturning }) }),
		};
		const repository = new CredentialRepository(db as never);

		await expect(
			repository.create({
				credential_name: "openai",
				credential_values: {},
				credential_info: {},
				created_by: "user-a",
				updated_by: "user-a",
			}),
		).resolves.toMatchObject({ credential_name: "openai" });
		await expect(repository.patch("openai", { updated_by: "user-b" })).resolves.toMatchObject({ credential_name: "openai" });
		await expect(repository.deleteByName("openai")).resolves.toBe(false);
		expect(insertReturning).toHaveBeenCalledTimes(1);
		expect(patchReturning).toHaveBeenCalledTimes(1);
		expect(deleteReturning).toHaveBeenCalledTimes(1);
	});

	it("createAndAttachToModel 先锁定模型，模型 update 零行显式失败", async () => {
		const tx = {
			execute: jest.fn().mockResolvedValue({ rows: [{ model_id: "model-1" }] }),
			select: jest.fn().mockReturnValue({
				from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([model]) }) }),
			}),
			insert: jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([stored]) }) }),
			update: jest.fn().mockReturnValue({
				set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }) }),
			}),
		};
		const db = { transaction: jest.fn((callback) => callback(tx)) };
		const repository = new CredentialRepository(db as never);

		await expect(
			repository.createAndAttachToModel("model-1", () => ({
				credential_name: "openai",
				credential_values: { api_key: "encrypted" },
				credential_info: {},
				created_by: "user-a",
				updated_by: "user-a",
			})),
		).rejects.toThrow("Locked model update did not return a row");
		expect(tx.execute).toHaveBeenCalledTimes(1);
	});

	it("将 PostgreSQL 唯一约束冲突转换为可识别错误且不泄露值", async () => {
		const values = jest
			.fn()
			.mockReturnValue({ returning: jest.fn().mockRejectedValue({ code: "23505", detail: "credential_values=(sk-secret)" }) });
		const repository = new CredentialRepository({ insert: jest.fn().mockReturnValue({ values: values }) } as never);

		const result = repository.create({
			credential_name: "openai",
			credential_values: { api_key: "sk-secret" },
			credential_info: {},
			created_by: "user-a",
			updated_by: "user-a",
		});
		await expect(result).rejects.toBeInstanceOf(CredentialRepositoryConflictError);
		await expect(result).rejects.not.toThrow("sk-secret");
	});
});
