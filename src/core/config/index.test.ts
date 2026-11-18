/**
 * 配置解析测试 — Python LiteLLM 风格配置严格对齐
 *
 * 覆盖：
 * - 仅 Python snake_case 顶层配置
 * - database_url 解析
 * - server.port/host 从 general_settings 派生
 * - router_settings 字段派生到 routerSettings
 * - snake_case 与 camelCase 冲突时 snake_case 优先
 * - 模型、Alias 与 fallback 的 YAML 键被忽略（只从数据库读取）
 */
import { validateAndTransform } from "./index";

describe("validateAndTransform — Python LiteLLM style", () => {
	it("仅 Python 风格配置能正常派生 server/database/routerSettings/generalSettings", () => {
		const raw = {
			litellm_settings: { drop_params: true },
			router_settings: { allowed_fails: 3, cooldown_time: 60, num_retries: 2 },
			general_settings: {
				master_key: "sk-master",
				port: 18183,
				host: "127.0.0.1",
				database_url: "postgresql://user:pass@dbhost:5432/mydb",
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
	});

	it("database_url 非法时启动失败", () => {
		expect(() =>
			validateAndTransform({
				general_settings: { database_url: "not-a-url" },
			}),
		).toThrow(/database_url/);
	});

	it("yaml 中的模型、Alias 与 fallback 键被忽略，不进入设置与 DB 默认值", () => {
		const config = validateAndTransform({
			model_list: [{ model_name: "gpt-5", litellm_params: { model: "openai/gpt-5" } }],
			router_settings: {
				model_group_alias: { foo: "bar" },
				fallbacks: [{ "gpt-5": ["gpt-5-mini"] }],
				max_fallbacks: 9,
				num_retries: 3,
			},
			general_settings: { model_group_alias: { baz: "qux" } },
		});
		expect(config.routerSettings).not.toHaveProperty("model_group_alias");
		expect(config.routerSettings).not.toHaveProperty("fallbacks");
		expect(config.routerSettings).not.toHaveProperty("max_fallbacks");
		expect(config.routerSettings.num_retries).toBe(3);
		expect(config.generalSettings).not.toHaveProperty("model_group_alias");
		expect(config.routerSettingsRaw).toEqual({ num_retries: 3 });
		expect(config.generalSettingsRaw).toEqual({});
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
		});
		expect(config.routerSettings).toBeDefined();
	});

	it("port 非数字时启动失败", () => {
		expect(() =>
			validateAndTransform({
				general_settings: { port: "abc" },
			}),
		).toThrow(/port/);
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
