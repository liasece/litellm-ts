/**
 * 配置解析测试 — Python LiteLLM 风格配置严格对齐
 *
 * 覆盖：
 * - 仅 Python snake_case 顶层配置
 * - database_url 解析
 * - server.port/host 从 general_settings 派生
 * - router_settings 字段派生到 routerSettings
 * - snake_case 与 camelCase 冲突时 snake_case 优先
 * - litellm_params Python 字段（api_base / api_key / extra_headers / extra_body）不丢
 */
import { validateAndTransform } from "./index";

describe("validateAndTransform — deployment sha256 id 生成（PY _generate_model_id 对齐）", () => {
	it("model_info.id 缺失时按 YAML 键序生成 sha256（回归 PY 实测向量）", () => {
		// PY litellm/router.py:6550 _generate_model_id：model_group + 键值按声明顺序拼接取 sha256。
		// 向量为 PY 实例（同参数）实测 deployment id：glm-4-7-anthropic → 5e49c98b…
		const raw = {
			model_list: [
				{
					model_name: "glm-4-7-anthropic",
					litellm_params: {
						model: "anthropic/glm-4.7",
						api_base: "https://open.bigmodel.cn/api/anthropic",
						api_key: "34365d9a2acc4ffc90a944b986bd2418.qFCAYvl1GnOmUXo3",
					},
				},
			],
		};
		const config = validateAndTransform(raw);
		expect(config.modelList[0]?.model_info?.id).toBe("5e49c98b2ca1d95217d90738a5778fd169efd1c24299c69d1e2419939ae92b78");
	});

	it("锚点合并场景保持 YAML 键序（api_base, api_key, model → 另一实测向量）", () => {
		// 锚点先声明 api_base/api_key，model 覆盖后仍保持锚点位置（与 PY yaml 合并行为一致）。
		// 向量为 PY 实例实测：gpt-5.5 → 88685ff9…
		const raw = {
			model_list: [
				{
					model_name: "gpt-5.5",
					litellm_params: {
						api_base: "http://192.168.1.220:8317",
						api_key: "sk-3G6FLwfA1xF0oOi04",
						model: "anthropic/gpt-5.5",
					},
				},
			],
		};
		const config = validateAndTransform(raw);
		expect(config.modelList[0]?.model_info?.id).toBe("88685ff91660f394c2d115693ecac1cc510d871f9d1a4f0f8d864c7ee15201be");
	});

	it("显式 model_info.id 保留不覆盖（PY 仅在缺失时生成）", () => {
		const raw = {
			model_list: [
				{
					model_name: "explicit-id-model",
					litellm_params: { model: "openai/gpt-5", api_key: "sk-test" },
					model_info: { id: "my-custom-id" },
				},
			],
		};
		const config = validateAndTransform(raw);
		expect(config.modelList[0]?.model_info?.id).toBe("my-custom-id");
	});

	it("model_info 整体缺失时也能生成 id 并保留其它字段", () => {
		const raw = {
			model_list: [
				{
					model_name: "no-info-model",
					litellm_params: { model: "openai/gpt-5", api_key: "sk-test" },
				},
				{
					model_name: "with-cost-model",
					litellm_params: { model: "openai/gpt-5", api_key: "sk-test" },
					model_info: { input_cost_per_token: 0.1 },
				},
			],
		};
		const config = validateAndTransform(raw);
		expect(config.modelList[0]?.model_info?.id).toMatch(/^[0-9a-f]{64}$/);
		expect(config.modelList[1]?.model_info?.id).toMatch(/^[0-9a-f]{64}$/);
		expect(config.modelList[1]?.model_info?.input_cost_per_token).toBe(0.1);
		// 键序不同（同值不同序）→ 不同哈希：证明顺序参与计算
		const reordered = validateAndTransform({
			model_list: [
				{
					model_name: "no-info-model",
					litellm_params: { api_key: "sk-test", model: "openai/gpt-5" },
				},
			],
		});
		expect(reordered.modelList[0]?.model_info?.id).not.toBe(config.modelList[0]?.model_info?.id);
	});
});

describe("validateAndTransform — Python LiteLLM style", () => {
	it("仅 Python 风格配置能正常派生 server/database/routerSettings/generalSettings", () => {
		const raw = {
			model_list: [
				{
					model_name: "gpt-5",
					litellm_params: {
						model: "openai/gpt-5",
						api_key: "sk-test",
						api_base: "http://upstream.test",
						custom_llm_provider: "openai",
						extra_headers: { "X-Custom": "value" },
						extra_body: { some_field: "value" },
					},
				},
			],
			litellm_settings: { drop_params: true },
			router_settings: { allowed_fails: 3, cooldown_time: 60, num_retries: 2 },
			general_settings: {
				master_key: "sk-master",
				port: 18183,
				host: "127.0.0.1",
				database_url: "postgresql://user:pass@dbhost:5432/mydb",
				model_group_alias: { foo: "bar" },
			},
		};
		const config = validateAndTransform(raw);
		expect(config.server.port).toBe(18183);
		expect(config.server.host).toBe("127.0.0.1");
		expect(config.database.host).toBe("dbhost");
		expect(config.database.port).toBe(5432);
		expect(config.database.database).toBe("mydb");
		expect(config.database.user).toBe("user");
		expect(config.database.password).toBe("pass");
		expect(config.routerSettings.allowed_fails).toBe(3);
		expect(config.routerSettings.cooldown_time).toBe(60);
		expect(config.routerSettings.num_retries).toBe(2);
		expect(config.generalSettings.master_key).toBe("sk-master");
		expect(config.generalSettings.database_url).toBe("postgresql://user:pass@dbhost:5432/mydb");
		expect(config.modelList).toHaveLength(1);
		expect(config.modelList[0]?.litellm_params.api_base).toBe("http://upstream.test");
		expect(config.modelList[0]?.litellm_params.api_key).toBe("sk-test");
		expect(config.modelList[0]?.litellm_params.extra_headers).toEqual({ "X-Custom": "value" });
		expect(config.modelList[0]?.litellm_params.extra_body).toEqual({ some_field: "value" });
	});

	it("snake_case 与 camelCase 冲突时 snake_case 优先", () => {
		const raw = {
			general_settings: { master_key: "sk-snake" },
			generalSettings: { master_key: "sk-camel" },
		};
		const config = validateAndTransform(raw);
		expect(config.generalSettings.master_key).toBe("sk-snake");
	});

	it("无配置时使用 server/database 默认值", () => {
		const config = validateAndTransform({});
		expect(config.server.port).toBe(4000);
		expect(config.server.host).toBe("0.0.0.0");
		expect(config.database.host).toBe("localhost");
		expect(config.database.port).toBe(5432);
		expect(config.modelList).toEqual([]);
	});

	it("database_url 非法时启动失败", () => {
		expect(() =>
			validateAndTransform({
				general_settings: { database_url: "not-a-url" },
			}),
		).toThrow(/database_url/);
	});

	it("router_settings.model_group_alias 派生到 routerSettings.model_group_alias", () => {
		const config = validateAndTransform({
			router_settings: { model_group_alias: { foo: "bar" } },
		});
		expect(config.routerSettings.model_group_alias).toEqual({ foo: "bar" });
	});

	it("litellmSettingsRaw 保留原始 Python 块", () => {
		const config = validateAndTransform({
			litellm_settings: { drop_params: true, telemetry: false },
		});
		expect(config.litellmSettingsRaw).toEqual({ drop_params: true, telemetry: false });
	});

	it("未知 Python 顶层字段不阻断", () => {
		const config = validateAndTransform({
			some_unknown_top_level_field: { foo: "bar" },
			model_list: [],
		});
		expect(config.modelList).toEqual([]);
	});

	it("port 非数字时启动失败", () => {
		expect(() =>
			validateAndTransform({
				general_settings: { port: "abc" },
			}),
		).toThrow(/port/);
	});

	it("未知 litellm_params 字段透传（如 anthropic_version / auth_token）", () => {
		const config = validateAndTransform({
			model_list: [
				{
					model_name: "x",
					litellm_params: {
						model: "anthropic/claude",
						anthropic_version: "2023-06-01",
						auth_token: "sk-ant-oat-xx",
						thinking: { type: "enabled" },
					},
				},
			],
		});
		const params = config.modelList[0]?.litellm_params;
		expect(params?.anthropic_version).toBe("2023-06-01");
		expect(params?.auth_token).toBe("sk-ant-oat-xx");
		expect(params?.thinking).toEqual({ type: "enabled" });
	});
});

describe("validateAndTransform — DATABASE_URL 环境变量覆盖", () => {
	const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
	const TEST_ENV_URL = "postgresql://envuser:envpass@envhost:6543/envdb";

	afterEach(() => {
		if (ORIGINAL_DATABASE_URL === undefined) {
			delete process.env.DATABASE_URL;
		} else {
			process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
		}
	});

	it("YAML 无 database_url 时, 环境变量 DATABASE_URL 派生 database 配置", () => {
		process.env.DATABASE_URL = TEST_ENV_URL;
		const config = validateAndTransform({});
		expect(config.database.host).toBe("envhost");
		expect(config.database.port).toBe(6543);
		expect(config.database.database).toBe("envdb");
		expect(config.database.user).toBe("envuser");
		expect(config.database.password).toBe("envpass");
		expect(config.generalSettings.database_url).toBe(TEST_ENV_URL);
	});

	it("DATABASE_URL 优先于 general_settings.database_url", () => {
		process.env.DATABASE_URL = TEST_ENV_URL;
		const config = validateAndTransform({
			general_settings: {
				database_url: "postgresql://yamluser:yamlpass@yamlhost:1111/yamldb",
			},
		});
		expect(config.database.host).toBe("envhost");
		expect(config.database.port).toBe(6543);
		expect(config.database.database).toBe("envdb");
		expect(config.database.user).toBe("envuser");
		expect(config.database.password).toBe("envpass");
		expect(config.generalSettings.database_url).toBe(TEST_ENV_URL);
	});

	it("DATABASE_URL 非法时抛出脱敏错误", () => {
		process.env.DATABASE_URL = "not-a-url-with-secret";
		let message = "";
		try {
			validateAndTransform({});
		} catch (error) {
			message = String(error);
		}
		expect(message).toMatch(/Invalid DATABASE_URL/);
		expect(message).not.toContain("secret");
	});

	it("无 DATABASE_URL 且 general_settings.database_url 非法时, 错误提示来源", () => {
		expect(() =>
			validateAndTransform({
				general_settings: { database_url: "not-a-url" },
			}),
		).toThrow(/Invalid general_settings\.database_url/);
	});

	it("DATABASE_URL 与顶层 database 字段冲突时, 环境变量优先", () => {
		process.env.DATABASE_URL = TEST_ENV_URL;
		const config = validateAndTransform({
			database: {
				host: "toplevelhost",
				port: 1111,
				database: "topleveldb",
				user: "topleveluser",
				password: "toplevelpass",
			},
		});
		// 顶层 database 字段被 DATABASE_URL 解析结果覆盖
		expect(config.database.host).toBe("envhost");
		expect(config.database.port).toBe(6543);
		expect(config.database.database).toBe("envdb");
	});

	it("保留 SSL、schema、timeout 与编码凭据连接串语义", () => {
		const databaseUrl =
			"postgresql://encoded%40user:p%2Fass@db.internal:5432/litellm?sslmode=require&schema=tenant_a&connect_timeout=12&options=-c%20statement_timeout%3D5000";
		process.env.DATABASE_URL = databaseUrl;
		const config = validateAndTransform({});
		expect(config.database.connectionString).toBe(databaseUrl);
		expect(config.database.user).toBe("encoded%40user");
		expect(config.database.password).toBe("p%2Fass");
	});

	it("general_settings.database_connection_pool_limit 进入数据库连接配置", () => {
		process.env.DATABASE_URL = TEST_ENV_URL;
		const config = validateAndTransform({ general_settings: { database_connection_pool_limit: 17 } });
		expect(config.database.maxConnections).toBe(17);
	});
});

describe("validateAndTransform — APP_PORT 环境变量覆盖", () => {
	const ORIGINAL_APP_PORT = process.env.APP_PORT;

	afterEach(() => {
		if (ORIGINAL_APP_PORT === undefined) {
			delete process.env.APP_PORT;
		} else {
			process.env.APP_PORT = ORIGINAL_APP_PORT;
		}
	});

	it("APP_PORT 存在时覆盖 server.port 默认值", () => {
		process.env.APP_PORT = "18183";
		const config = validateAndTransform({});
		expect(config.server.port).toBe(18183);
	});

	it("APP_PORT 存在时覆盖 general_settings.port", () => {
		process.env.APP_PORT = "18183";
		const config = validateAndTransform({
			general_settings: { port: 4000 },
		});
		expect(config.server.port).toBe(18183);
	});

	it("APP_PORT 存在时覆盖顶层 server.port", () => {
		process.env.APP_PORT = "18183";
		const config = validateAndTransform({
			server: { port: 5000, host: "0.0.0.0" },
		});
		expect(config.server.port).toBe(18183);
	});

	it("APP_PORT 非数字时抛出错误", () => {
		process.env.APP_PORT = "abc";
		expect(() => validateAndTransform({})).toThrow(/Invalid APP_PORT/);
	});
});

describe("validateAndTransform — LITELLM_MASTER_KEY 环境变量覆盖", () => {
	const ORIGINAL_MASTER_KEY = process.env.LITELLM_MASTER_KEY;

	afterEach(() => {
		if (ORIGINAL_MASTER_KEY === undefined) {
			delete process.env.LITELLM_MASTER_KEY;
		} else {
			process.env.LITELLM_MASTER_KEY = ORIGINAL_MASTER_KEY;
		}
	});

	it("LITELLM_MASTER_KEY 存在时覆盖 general_settings.master_key", () => {
		process.env.LITELLM_MASTER_KEY = "sk-env-master";
		const config = validateAndTransform({
			general_settings: { master_key: "sk-yaml-master" },
		});
		expect(config.generalSettings.master_key).toBe("sk-env-master");
	});

	it("LITELLM_MASTER_KEY 存在时覆盖 generalSettings.camelCase master_key", () => {
		process.env.LITELLM_MASTER_KEY = "sk-env-master";
		const config = validateAndTransform({
			generalSettings: { master_key: "sk-camel-master" },
		});
		expect(config.generalSettings.master_key).toBe("sk-env-master");
	});

	it("LITELLM_MASTER_KEY 优先于 snake_case general_settings.master_key", () => {
		process.env.LITELLM_MASTER_KEY = "sk-env-master";
		const config = validateAndTransform({
			general_settings: { master_key: "sk-snake-master" },
			generalSettings: { master_key: "sk-camel-master" },
		});
		expect(config.generalSettings.master_key).toBe("sk-env-master");
	});

	it("LITELLM_MASTER_KEY 不存在时保留 snake_case master_key", () => {
		const config = validateAndTransform({
			general_settings: { master_key: "sk-snake-master" },
		});
		expect(config.generalSettings.master_key).toBe("sk-snake-master");
	});
});
