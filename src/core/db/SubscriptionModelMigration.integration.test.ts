import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const connectionString = process.env.TEST_DATABASE_URL;
const migration = readFileSync(resolve(__dirname, "../../../drizzle/0014_subscription_model_identity.sql"), "utf8").split(
	"--> statement-breakpoint",
);
const suite = connectionString ? describe : describe.skip;

suite("subscription deployment data migration", () => {
	let client: Client;
	beforeEach(async () => {
		client = new Client({ connectionString });
		await client.connect();
		await client.query("BEGIN");
		await client.query('CREATE TEMP TABLE "LiteLLM_Config" (param_name text PRIMARY KEY, param_value jsonb)');
		await client.query(
			'CREATE TEMP TABLE "LiteLLM_ProxyModelTable" (model_id text PRIMARY KEY, model_name text, litellm_params jsonb, model_info jsonb)',
		);
	});
	afterEach(async () => {
		await client.query("ROLLBACK");
		await client.end();
	});

	async function insert(id: string, model: string, provider: string, info: Record<string, unknown> = {}) {
		await client.query('INSERT INTO "LiteLLM_ProxyModelTable" VALUES ($1, $2, $3, $4)', [
			id,
			"alias-" + id,
			{
				model,
				custom_llm_provider: provider,
				rpm: 21,
				...(provider === "cliproxy" ? { subscription_transport: "compatibility" } : {}),
			},
			info,
		]);
	}
	async function migrate() {
		for (const sql of migration) {
			await client.query(sql);
		}
	}

	it("rewrites the current configuration in place, including missing catalog models, while keeping aliases, IDs and prices", async () => {
		await insert("codex", "cliproxy/gpt-5.3-codex-spark", "cliproxy", {
			key: "cliproxy/gpt-5.3-codex-spark",
			input_cost_per_token: 0.2,
		});
		await insert("kimi", "cliproxy/kimi-k3", "cliproxy");
		await insert("cc", "cliproxy/commandcode/vendor/model", "cliproxy", {
			key: "cliproxy/commandcode/vendor/model",
			litellm_provider: "cliproxy",
		});
		await insert("oc", "opencode-go/vendor/model", "opencode-go");
		await insert("direct", "openai/gpt-5.4", "openai");
		await client.query('INSERT INTO "LiteLLM_Config" VALUES ($1,$2)', [
			"litellm_settings",
			{
				cost_discount_config: { cliproxy: 0.6, commandcode: 0 },
				cost_margin_config: { cliproxy: { percentage: 0.2 }, global: 0.1 },
				other: true,
			},
		]);
		await migrate();
		const rows = await client.query('SELECT * FROM "LiteLLM_ProxyModelTable" ORDER BY model_id');
		const expected: Record<string, [string, string]> = {
			codex: ["codex-subscription", "gpt-5.3-codex-spark"],
			kimi: ["kimi-subscription", "kimi-k3"],
			cc: ["commandcode", "vendor/model"],
			oc: ["opencode-go", "vendor/model"],
			direct: ["openai", "openai/gpt-5.4"],
		};
		for (const row of rows.rows) {
			const [source, model] = expected[row.model_id]!;
			expect(row.model_name).toBe("alias-" + row.model_id);
			expect(row.litellm_params).toEqual({ model, custom_llm_provider: source, rpm: 21 });
		}
		expect(rows.rows.find((r) => r.model_id === "cc").model_info).toEqual({ key: "vendor/model", litellm_provider: "commandcode" });
		expect(rows.rows.find((r) => r.model_id === "codex").model_info).toEqual({ key: "gpt-5.3-codex-spark", input_cost_per_token: 0.2 });
		const settings = (await client.query('SELECT param_value FROM "LiteLLM_Config"')).rows[0].param_value;
		expect(settings).toMatchObject({
			other: true,
			cost_discount_config: { commandcode: 0, "opencode-go": 0.6 },
			cost_margin_config: { global: 0.1, "kimi-subscription": { percentage: 0.2 } },
		});
		expect(settings.cost_discount_config).not.toHaveProperty("cliproxy");
		await expect(insert("invalid", "cliproxy/wrong", "openai")).rejects.toMatchObject({ code: "23514" });
	});

	it("refuses an unidentified old deployment atomically instead of charging another account", async () => {
		await insert("known", "cliproxy/gpt-5.4", "cliproxy");
		await insert("ambiguous", "cliproxy/claude-sonnet-4-6", "cliproxy");
		await client.query("SAVEPOINT before_migration");
		await expect(migrate()).rejects.toThrow(/explicit account provider/);
		await client.query("ROLLBACK TO SAVEPOINT before_migration");
		const before = await client.query('SELECT litellm_params FROM "LiteLLM_ProxyModelTable"');
		expect(before.rows.every((row) => row.litellm_params.custom_llm_provider === "cliproxy")).toBe(true);
	});
});
