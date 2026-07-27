import express from "express";
import request from "supertest";
import { CredentialRuntimeAccessor } from "../credentials/CredentialRuntimeAccessor";
import {
	CredentialService,
	type AttachedCredentialResult,
	type CredentialAttachmentFactory,
	type CredentialRepositoryPort,
	type StoredCredential,
} from "../credentials/CredentialService";
import type { ProxyModelRowLike } from "../router/ProxyModelDeployment";
import type { Deployment } from "../types/router";
import { registerCredentialRoutes } from "./CredentialEndpoints";

class FakeRepository implements CredentialRepositoryPort {
	readonly rows = new Map<string, StoredCredential>();
	referenced = false;
	model: ProxyModelRowLike | null = null;

	async list(): Promise<StoredCredential[]> {
		return [...this.rows.values()];
	}

	async create(credential: StoredCredential): Promise<StoredCredential> {
		if (this.rows.has(credential.credential_name)) {
			throw Object.assign(new Error("conflict"), { code: "CREDENTIAL_NAME_CONFLICT" });
		}
		this.rows.set(credential.credential_name, credential);
		return credential;
	}

	async findByName(name: string): Promise<StoredCredential | null> {
		return this.rows.get(name) ?? null;
	}

	async patch(name: string, patch: Partial<StoredCredential>): Promise<StoredCredential | null> {
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

	async createAndAttachToModel(modelId: string, createCredential: CredentialAttachmentFactory): Promise<AttachedCredentialResult | null> {
		if (this.model === null || this.model.model_id !== modelId) {
			return null;
		}
		const params = { ...(this.model.litellm_params as Record<string, unknown>) };
		const credential = createCredential(params);
		const model = {
			model_id: this.model.model_id,
			model_name: this.model.model_name,
			litellm_params: params,
			model_info: (this.model.model_info as Record<string, unknown> | null | undefined) ?? null,
			created_by: "user-a",
			updated_by: "user-a",
		};
		if (credential === null) {
			return { credential: null, model: model };
		}
		await this.create(credential);
		for (const fieldName of Object.keys(credential.credential_values)) {
			delete params[fieldName];
		}
		params["litellm_credential_name"] = credential.credential_name;
		this.model = { ...this.model, litellm_params: params };
		return { credential: credential, model: { ...model, litellm_params: params, updated_by: credential.updated_by } };
	}
}

function makeApp(): {
	readonly app: express.Express;
	readonly repository: FakeRepository;
	readonly router: { getDeployment: jest.Mock<Deployment | null, [string]>; upsertDeployment: jest.Mock };
} {
	const repository = new FakeRepository();
	const service = new CredentialService(repository, new CredentialRuntimeAccessor());
	const litellmRouter = {
		getDeployment: jest.fn<Deployment | null, [string]>(() => null),
		upsertDeployment: jest.fn(),
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { user_id: "user-a" } as never;
		next();
	});
	const router = express.Router();
	registerCredentialRoutes(router, service, litellmRouter as never);
	app.use(router);
	return { app: app, repository: repository, router: litellmRouter };
}

function deployment(modelId: string, params: Record<string, unknown>): Deployment {
	return {
		model_name: "logical-model",
		litellm_params: { model: "openai/gpt-4o", ...params },
		model_info: { id: modelId },
	};
}

describe("CredentialEndpoints", () => {
	it("普通 CRUD 使用持久服务、固定掩码并支持特殊字符路径", async () => {
		const { app } = makeApp();
		const name = "aws/prod + east";
		expect((await request(app).post("/credentials").send({})).status).toBe(400);
		expect(
			(
				await request(app)
					.post("/credentials")
					.send({
						credential_name: name,
						credential_values: { api_key: "sk-secret", region: 1 },
					})
			).body,
		).toEqual({ success: true, credential_name: name });

		const list = await request(app).get("/credentials");
		expect(list.body.credentials[0].credential_values).toEqual({ api_key: "********", region: "********" });
		const byName = await request(app).get(`/credentials/by_name/${encodeURIComponent(name)}`);
		expect(byName.status).toBe(200);
		expect(byName.body.credential_values).toEqual({ api_key: "********", region: "********" });

		expect(
			(
				await request(app)
					.patch(`/credentials/${encodeURIComponent(name)}`)
					.send({ credential_values: { api_key: "********" } })
			).status,
		).toBe(400);
		expect(
			(
				await request(app)
					.patch(`/credentials/${encodeURIComponent(name)}`)
					.send({ credential_name: name })
			).status,
		).toBe(400);
		expect(
			(
				await request(app)
					.patch(`/credentials/${encodeURIComponent(name)}`)
					.send({ credential_values: { api_key: "sk-next" } })
			).body,
		).toEqual({ success: true });
		expect((await request(app).delete(`/credentials/${encodeURIComponent(name)}`)).body).toEqual({ success: true });
		expect((await request(app).get(`/credentials/by_name/${encodeURIComponent(name)}`)).status).toBe(404);
	});

	it("唯一冲突与被引用删除映射为 409", async () => {
		const { app, repository } = makeApp();
		await request(app)
			.post("/credentials")
			.send({ credential_name: "shared", credential_values: { api_key: "one" } });
		expect(
			(
				await request(app)
					.post("/credentials")
					.send({ credential_name: "shared", credential_values: { api_key: "two" } })
			).status,
		).toBe(409);
		repository.referenced = true;
		expect((await request(app).delete("/credentials/shared")).status).toBe(409);
	});

	it("by_model 按 Router deployment ID 返回命名引用或 inline 字段的固定掩码", async () => {
		const { app, router } = makeApp();
		await request(app)
			.post("/credentials")
			.send({
				credential_name: "named",
				credential_values: { api_key: "sk-secret" },
				credential_info: { custom_llm_provider: "openai" },
			});
		router.getDeployment.mockReturnValueOnce(deployment("model-named", { litellm_credential_name: "named" }));
		const named = await request(app).get("/credentials/by_model/model-named");
		expect(named.body).toMatchObject({ credential_name: "named", credential_values: { api_key: "********" } });

		router.getDeployment.mockReturnValueOnce(deployment("model-inline", { api_key: "sk-inline", api_base: "https://api.example" }));
		const inline = await request(app).get("/credentials/by_model/model-inline");
		expect(inline.body).toEqual({
			credential_name: "model-inline",
			credential_values: { api_key: "********", api_base: "********" },
			credential_info: { custom_llm_provider: "openai" },
		});
	});

	it("by_model 对模型、命名引用、provider 字段缺失返回明确 404/409", async () => {
		const { app, router } = makeApp();
		expect((await request(app).get("/credentials/by_model/missing")).status).toBe(404);
		router.getDeployment.mockReturnValueOnce(deployment("missing-ref", { litellm_credential_name: "absent" }));
		expect((await request(app).get("/credentials/by_model/missing-ref")).status).toBe(404);
		router.getDeployment.mockReturnValueOnce({
			...deployment("unknown-provider", {}),
			litellm_params: { model: "unknown-provider/model" },
		});
		expect((await request(app).get("/credentials/by_model/unknown-provider")).status).toBe(409);
		router.getDeployment.mockReturnValueOnce(deployment("missing-fields", { timeout: 10 }));
		expect((await request(app).get("/credentials/by_model/missing-fields")).status).toBe(409);
	});

	it("attach_to_model 创建凭据、移除 inline secret，并在提交后同步 Router，响应不含 secret", async () => {
		const { app, repository, router } = makeApp();
		repository.model = {
			model_id: "model-1",
			model_name: "logical-model",
			litellm_params: { model: "openai/gpt-4o", api_key: "sk-inline", api_base: "https://api.example", timeout: 10 },
			model_info: {},
		};
		router.getDeployment.mockReturnValue(deployment("model-1", { litellm_credential_name: "attached" }));
		const response = await request(app)
			.post("/credentials")
			.send({
				credential_name: "attached",
				model_id: "model-1",
				attach_to_model: true,
				credential_info: { custom_llm_provider: "openai" },
			});

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ success: true, credential_name: "attached" });
		expect(JSON.stringify(response.body)).not.toContain("sk-inline");
		expect(repository.model?.litellm_params).toEqual({
			model: "openai/gpt-4o",
			timeout: 10,
			litellm_credential_name: "attached",
		});
		expect(router.upsertDeployment).toHaveBeenCalledTimes(1);
	});
});
