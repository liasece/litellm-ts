import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { CredentialRepository } from "../repositories/CredentialRepository";
import { CredentialRuntimeAccessor } from "./CredentialRuntimeAccessor";
import { CredentialSecretBox } from "./CredentialSecretBox";
import { CredentialService } from "./CredentialService";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("Credential PostgreSQL persistence integration", () => {
	const testSchema = `litellm_credential_test_${process.pid}_${Date.now()}`;
	let adminPool: Pool;
	let pool: Pool;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeAll(async () => {
		adminPool = new Pool({ connectionString: databaseUrl });
		await adminPool.query(`CREATE SCHEMA "${testSchema}"`);
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${testSchema}`, max: 5 });
		db = drizzle(pool, { schema: schema });
		await db.execute(sql`CREATE TABLE "LiteLLM_CredentialsTable" (
			credential_id text PRIMARY KEY,
			credential_name text NOT NULL UNIQUE,
			credential_values jsonb NOT NULL,
			credential_info jsonb,
			created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_by text NOT NULL,
			updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_by text NOT NULL
		)`);
		await db.execute(sql`CREATE TABLE "LiteLLM_ProxyModelTable" (
			model_id text PRIMARY KEY,
			model_name text NOT NULL,
			litellm_params jsonb NOT NULL,
			model_info jsonb,
			created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
			created_by text NOT NULL,
			updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_by text NOT NULL
		)`);
	});

	beforeEach(async () => {
		await db.execute(sql`DROP TRIGGER IF EXISTS credential_test_skip_model_update ON "LiteLLM_ProxyModelTable"`);
		await db.execute(sql`DROP FUNCTION IF EXISTS credential_test_skip_model_update()`);
		await db.execute(sql`TRUNCATE "LiteLLM_CredentialsTable", "LiteLLM_ProxyModelTable"`);
	});

	afterAll(async () => {
		if (pool) {
			await pool.end();
		}
		if (adminPool) {
			await adminPool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
			await adminPool.end();
		}
	});

	function makeService(legacySecretBox: CredentialSecretBox | null = null) {
		const accessor = new CredentialRuntimeAccessor();
		const service = new CredentialService(new CredentialRepository(db as never), accessor, legacySecretBox);
		return { accessor: accessor, service: service };
	}

	async function insertInlineModel(modelId: string, extraParams: Record<string, unknown> = {}): Promise<void> {
		await db.execute(sql`INSERT INTO "LiteLLM_ProxyModelTable"
			(model_id, model_name, litellm_params, model_info, created_by, updated_by)
			VALUES (${modelId}, 'integration-model', ${JSON.stringify({
				model: "openai/gpt-4o",
				custom_llm_provider: "openai",
				api_key: "sk-inline-secret",
				api_base: "https://api.example.test/v1",
				...extraParams,
			})}::jsonb, ${JSON.stringify({ id: modelId, db_model: true })}::jsonb, 'creator', 'creator')`);
	}

	it("创建并关联后真实落库明文，清除 inline secret，重建服务可恢复", async () => {
		await insertInlineModel("model-persist");
		const first = makeService();

		const updatedModel = await first.service.createFromModel(
			{
				credential_name: "persisted-openai",
				model_id: "model-persist",
				credential_info: { description: "integration" },
			},
			"actor-a",
		);

		expect(updatedModel.litellm_params).toMatchObject({
			model: "openai/gpt-4o",
			litellm_credential_name: "persisted-openai",
		});
		expect(updatedModel.litellm_params).not.toHaveProperty("api_key");
		expect(updatedModel.litellm_params).not.toHaveProperty("api_base");

		const credentialRows = await pool.query<{
			credential_values: Record<string, unknown>;
			credential_info: Record<string, unknown>;
		}>('SELECT credential_values, credential_info FROM "LiteLLM_CredentialsTable" WHERE credential_name = $1', ["persisted-openai"]);
		expect(credentialRows.rows).toHaveLength(1);
		const storedValues = credentialRows.rows[0]!.credential_values;
		expect(storedValues).toEqual({
			api_key: "sk-inline-secret",
			api_base: "https://api.example.test/v1",
		});
		expect(credentialRows.rows[0]!.credential_info).toEqual({
			custom_llm_provider: "openai",
			description: "integration",
		});

		const modelRows = await pool.query<{ litellm_params: Record<string, unknown> }>(
			'SELECT litellm_params FROM "LiteLLM_ProxyModelTable" WHERE model_id = $1',
			["model-persist"],
		);
		expect(modelRows.rows[0]!.litellm_params).toMatchObject({
			model: "openai/gpt-4o",
			custom_llm_provider: "openai",
			litellm_credential_name: "persisted-openai",
		});
		expect(modelRows.rows[0]!.litellm_params).not.toHaveProperty("api_key");
		expect(modelRows.rows[0]!.litellm_params).not.toHaveProperty("api_base");

		const restarted = makeService();
		await restarted.service.load();
		expect(restarted.accessor.getValues("persisted-openai")).toEqual({
			api_key: "sk-inline-secret",
			api_base: "https://api.example.test/v1",
		});
	});

	it("字符串与非字符串值均以原始 JSON 类型明文落库，重建服务后保持类型", async () => {
		const first = makeService();
		await first.service.create(
			{
				credential_name: "azure-typed",
				credential_values: { api_key: "sk-typed", api_version: 2, use_azure_ad: true, regions: ["us-east-1"] },
			},
			"actor-a",
		);

		const rows = await pool.query<{ credential_values: Record<string, unknown> }>(
			'SELECT credential_values FROM "LiteLLM_CredentialsTable" WHERE credential_name = $1',
			["azure-typed"],
		);
		const storedValues = rows.rows[0]!.credential_values;
		expect(storedValues).toEqual({
			api_key: "sk-typed",
			api_version: 2,
			use_azure_ad: true,
			regions: ["us-east-1"],
		});

		const restarted = makeService();
		await restarted.service.load();
		expect(restarted.accessor.getValues("azure-typed")).toEqual({
			api_key: "sk-typed",
			api_version: 2,
			use_azure_ad: true,
			regions: ["us-east-1"],
		});
	});

	it("启动时将旧 SecretBox 字段原子改写为可直接查询的明文", async () => {
		const secretBox = new CredentialSecretBox("legacy-integration-key");
		await pool.query(
			`INSERT INTO "LiteLLM_CredentialsTable"
			 (credential_id, credential_name, credential_values, credential_info, created_by, updated_by)
			 VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $5)`,
			[
				"legacy-id",
				"legacy-openai",
				JSON.stringify({ api_key: secretBox.encrypt("sk-legacy"), already_plain: "https://plain.example" }),
				JSON.stringify({ custom_llm_provider: "openai" }),
				"actor-a",
			],
		);

		const restarted = makeService(secretBox);
		await restarted.service.load();

		const rows = await pool.query<{ credential_values: Record<string, unknown> }>(
			'SELECT credential_values FROM "LiteLLM_CredentialsTable" WHERE credential_name = $1',
			["legacy-openai"],
		);
		expect(rows.rows[0]!.credential_values).toEqual({
			api_key: "sk-legacy",
			already_plain: "https://plain.example",
		});
		expect(restarted.accessor.getValues("legacy-openai")).toEqual(rows.rows[0]!.credential_values);
	});

	it("原子删除：未引用可删，有引用返回 409 且双方数据保持不变", async () => {
		await insertInlineModel("model-delete-guard");
		const first = makeService();
		await first.service.create({ credential_name: "free-credential", credential_values: { api_key: "sk-free" } }, "actor-a");
		await first.service.createFromModel({ credential_name: "bound-credential", model_id: "model-delete-guard" }, "actor-a");

		expect(await first.service.delete("free-credential")).toBe(true);
		expect(first.accessor.get("free-credential")).toBeUndefined();
		const freedRows = await pool.query('SELECT 1 FROM "LiteLLM_CredentialsTable" WHERE credential_name = $1', ["free-credential"]);
		expect(freedRows.rowCount).toBe(0);

		await expect(first.service.delete("bound-credential")).rejects.toMatchObject({ statusCode: 409 });
		const boundRows = await pool.query('SELECT 1 FROM "LiteLLM_CredentialsTable" WHERE credential_name = $1', ["bound-credential"]);
		expect(boundRows.rowCount).toBe(1);
		const model = await pool.query<{ litellm_params: Record<string, unknown> }>(
			'SELECT litellm_params FROM "LiteLLM_ProxyModelTable" WHERE model_id = $1',
			["model-delete-guard"],
		);
		expect(model.rows[0]!.litellm_params.litellm_credential_name).toBe("bound-credential");
	});

	it("模型 UPDATE 影响零行时回滚，不留下孤立 Credential", async () => {
		await insertInlineModel("model-rollback");
		await db.execute(sql`CREATE FUNCTION credential_test_skip_model_update() RETURNS trigger AS $$
		BEGIN
			RETURN NULL;
		END;
		$$ LANGUAGE plpgsql`);
		await db.execute(sql`CREATE TRIGGER credential_test_skip_model_update
			BEFORE UPDATE ON "LiteLLM_ProxyModelTable"
			FOR EACH ROW EXECUTE FUNCTION credential_test_skip_model_update()`);
		const { service } = makeService();

		await expect(service.createFromModel({ credential_name: "must-rollback", model_id: "model-rollback" }, "actor-a")).rejects.toThrow(
			"Locked model update did not return a row",
		);

		const credentialCount = await pool.query<{ count: string }>(
			'SELECT count(*)::text AS count FROM "LiteLLM_CredentialsTable" WHERE credential_name = $1',
			["must-rollback"],
		);
		expect(Number(credentialCount.rows[0]!.count)).toBe(0);
		const model = await pool.query<{ litellm_params: Record<string, unknown> }>(
			'SELECT litellm_params FROM "LiteLLM_ProxyModelTable" WHERE model_id = $1',
			["model-rollback"],
		);
		expect(model.rows[0]!.litellm_params).toMatchObject({
			api_key: "sk-inline-secret",
			api_base: "https://api.example.test/v1",
		});
		expect(model.rows[0]!.litellm_params).not.toHaveProperty("litellm_credential_name");
	});

	it("模型行锁确保 Re-use 基于并发更新后的最新 JSONB", async () => {
		await insertInlineModel("model-concurrent", { timeout: 10 });
		const blocker = await pool.connect();
		try {
			await blocker.query("BEGIN");
			await blocker.query('SELECT model_id FROM "LiteLLM_ProxyModelTable" WHERE model_id = $1 FOR UPDATE', ["model-concurrent"]);
			const { service } = makeService();
			const attaching = service.createFromModel({ credential_name: "concurrent-openai", model_id: "model-concurrent" }, "actor-a");
			await blocker.query(
				`UPDATE "LiteLLM_ProxyModelTable"
				 SET litellm_params = jsonb_set(litellm_params, '{timeout}', '42'::jsonb), updated_by = 'concurrent-editor'
				 WHERE model_id = $1`,
				["model-concurrent"],
			);
			await blocker.query("COMMIT");
			await attaching;
		} finally {
			if (!blocker.release) {
				return;
			}
			blocker.release();
		}

		const model = await pool.query<{ litellm_params: Record<string, unknown> }>(
			'SELECT litellm_params FROM "LiteLLM_ProxyModelTable" WHERE model_id = $1',
			["model-concurrent"],
		);
		expect(model.rows[0]!.litellm_params).toMatchObject({
			timeout: 42,
			litellm_credential_name: "concurrent-openai",
		});
		expect(model.rows[0]!.litellm_params).not.toHaveProperty("api_key");
		expect(model.rows[0]!.litellm_params).not.toHaveProperty("api_base");
	});
});
