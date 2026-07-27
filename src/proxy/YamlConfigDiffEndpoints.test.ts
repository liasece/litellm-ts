/**
 * /config/yaml_diff 端点测试（批次 E3）
 *
 * 覆盖：
 * - 鉴权：非 proxy_admin → 403
 * - GET：返回 has_pending + items
 * - accept 设置段：yaml 值深合并落库 + router_settings 热应用 + pending 移除
 * - accept model_list：db_missing 生成 model_id 落库 + Router 热更新；
 *   params_differ 沿用 DB model_id 替换参数
 * - accept 未知项 → 404
 * - resolve：写 config_yaml_snapshot 快照 + 清 pending
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import express from "express";
import request from "supertest";
import { registerWebUiSupportRoutes } from "./WebUiSupportEndpoints";
import { loadConfig, resetConfig } from "../core/config";
import type { ServiceConfig } from "../core/config";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { CONFIG_YAML_SNAPSHOT_PARAM, computeCurrentYamlSnapshot, yamlConfigDiffService } from "../core/config/YamlConfigDiffService";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";
import { Router as LiteLLMRouter } from "../router/Router";
import { RoutingStrategyName } from "../types/router";
import type { ProxyModelRowLike } from "../router/ProxyModelDeployment";

function makeConfig(): ServiceConfig {
	return {
		server: { port: 4000, host: "0.0.0.0" },
		logging: { level: "info" },
		database: { host: "localhost", port: 5432, database: "litellm", user: "litellm", password: "litellm" },
		litellmSettings: { defaultModel: null, maxRetries: 0, requestTimeoutMs: null, cacheModelConfig: false },
		routerSettings: {
			strategy: "cost-based",
			healthCheckIntervalSec: 300,
			maxConsecutiveFailures: 5,
			fallbacks: [],
			model_group_alias: {},
		},
		generalSettings: {
			environment: "development",
			verboseErrors: false,
			tempDir: "/tmp",
			master_key: "sk-test-master-key",
			model_group_alias: {},
		},
		modelList: [],
		generalSettingsRaw: {},
	} as unknown as ServiceConfig;
}

/**
 * 内存 mock db：LiteLLM_Config（param upsert）+ LiteLLM_ProxyModelTable（按 model_id upsert）
 * @param initialConfig
 * @param initialModels
 */
function makeMockDb(initialConfig: Record<string, unknown> = {}, initialModels: ProxyModelRowLike[] = []) {
	const configStore = new Map<string, unknown>(Object.entries(initialConfig));
	const modelStore = new Map<string, Record<string, unknown>>(initialModels.map((m) => [m.model_id, { ...m }]));
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const rows =
					table === LiteLLM_ProxyModelTable
						? Array.from(modelStore.values())
						: Array.from(configStore, ([param_name, param_value]) => ({ param_name: param_name, param_value: param_value }));
				const promise = Promise.resolve(rows);
				return Object.assign(promise, { where: () => promise, limit: () => promise });
			},
		}),
		insert: (table: unknown) => ({
			values: (row: Record<string, unknown>) => ({
				onConflictDoUpdate: (opts?: { set?: Record<string, unknown> }) => {
					if (table === LiteLLM_ProxyModelTable) {
						const modelId = row["model_id"] as string;
						const existing = modelStore.get(modelId);
						modelStore.set(modelId, existing ? { ...existing, ...(opts?.set ?? {}) } : { ...row });
					} else {
						configStore.set(row["param_name"] as string, row["param_value"]);
					}
					return Promise.resolve();
				},
			}),
		}),
	};
	return { db: db, configStore: configStore, modelStore: modelStore };
}

function buildApp(db: unknown, litellmRouter?: LiteLLMRouter, userRole = "proxy_admin"): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	router.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_role: userRole } as never;
		next();
	});
	registerWebUiSupportRoutes(router, makeConfig(), db as never, litellmRouter);
	app.use(router);
	return app;
}

function makeRouter(): LiteLLMRouter {
	return new LiteLLMRouter({ model_list: [], routing_strategy: RoutingStrategyName.SimpleShuffle, num_retries: 0 });
}

/**
 * 写入临时 yaml 并加载（设置 lastRawYaml 供差异检测）
 * @param content
 */
function loadYamlFromString(content: string): void {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yaml-diff-ep-")), "config.yaml");
	fs.writeFileSync(file, content);
	process.env.CONFIG_PATH = file;
	resetConfig();
	loadConfig();
}

afterEach(async () => {
	resetConfig();
	delete process.env.CONFIG_PATH;
	// 复位全局单例：raw 已清空，initialize 会将 pending 置空后提前返回；
	// dbConfigProvider 回到空库，避免污染后续读取方
	await yamlConfigDiffService.initialize(makeMockDb().db as never);
	await dbConfigProvider.initialize(makeMockDb().db as never);
});

describe("GET /config/yaml_diff", () => {
	it("非 proxy_admin → 403", async () => {
		loadYamlFromString("general_settings:\n  a: 1\n");
		const { db } = makeMockDb();
		const app = buildApp(db, undefined, "internal_user");
		const res = await request(app).get("/config/yaml_diff");
		expect(res.status).toBe(403);
	});

	it("admin：返回 has_pending 与差异项", async () => {
		loadYamlFromString("general_settings:\n  ui_access_mode: all\n");
		const { db } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		await yamlConfigDiffService.initialize(db as never);
		const app = buildApp(db);
		const res = await request(app).get("/config/yaml_diff");
		expect(res.status).toBe(200);
		expect(res.body.has_pending).toBe(true);
		expect(res.body.items).toEqual([
			{ section: "general_settings", key: "ui_access_mode", yaml_value: "all", db_value: null, diff_kind: "db_missing" },
		]);
	});
});

describe("POST /config/yaml_diff/accept", () => {
	it("非 proxy_admin → 403", async () => {
		loadYamlFromString("general_settings:\n  a: 1\n");
		const { db } = makeMockDb();
		const app = buildApp(db, undefined, "internal_user");
		const res = await request(app).post("/config/yaml_diff/accept").send({ section: "general_settings", key: "a" });
		expect(res.status).toBe(403);
	});

	it("设置段：yaml 值深合并落库并从 pending 移除", async () => {
		loadYamlFromString("general_settings:\n  alerting: [slack]\n");
		const { db, configStore } = makeMockDb({
			[CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" },
			general_settings: { alerting: ["email"], master_key: "sk-db" },
		});
		await yamlConfigDiffService.initialize(db as never);
		await dbConfigProvider.initialize(db as never);
		const app = buildApp(db);

		const res = await request(app).post("/config/yaml_diff/accept").send({ section: "general_settings", key: "alerting" });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "success", remaining_items: 0 });
		expect(configStore.get("general_settings")).toEqual({ alerting: ["slack"], master_key: "sk-db" });
		expect(yamlConfigDiffService.hasPending()).toBe(false);
	});

	it("router_settings 段：只落库，Router 基础内存不作为动态真源", async () => {
		loadYamlFromString("router_settings:\n  fallbacks:\n    - gpt-4o: [gpt-4o-mini]\n");
		const { db, configStore } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		await yamlConfigDiffService.initialize(db as never);
		const litellmRouter = makeRouter();
		const app = buildApp(db, litellmRouter);

		expect(litellmRouter.getFallbacks()).toEqual({});
		const res = await request(app).post("/config/yaml_diff/accept").send({ section: "router_settings", key: "fallbacks" });
		expect(res.status).toBe(200);
		expect(configStore.get("router_settings")).toEqual({ fallbacks: [{ "gpt-4o": ["gpt-4o-mini"] }] });
		expect(litellmRouter.getFallbacks()).toEqual({});
	});

	it("model_list db_missing：生成 model_id 落库，下一请求从数据库读取", async () => {
		loadYamlFromString(
			"model_list:\n  - model_name: claude-a\n    litellm_params:\n      model: anthropic/claude-a\n      api_key: sk-x\n",
		);
		const { db, modelStore } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		await yamlConfigDiffService.initialize(db as never);
		const litellmRouter = makeRouter();
		const app = buildApp(db, litellmRouter);

		const res = await request(app).post("/config/yaml_diff/accept").send({ section: "model_list", key: "claude-a" });
		expect(res.status).toBe(200);
		expect(modelStore.size).toBe(1);
		const row = Array.from(modelStore.values())[0]!;
		expect(row["model_name"]).toBe("claude-a");
		expect(row["litellm_params"]).toEqual({ model: "anthropic/claude-a", api_key: "sk-x" });
		expect(typeof row["model_id"]).toBe("string");
		expect(litellmRouter.getDeployment(row["model_id"] as string)).toBeNull();
	});

	it("model_list params_differ：沿用 DB model_id 替换参数", async () => {
		loadYamlFromString("model_list:\n  - model_name: m\n    litellm_params:\n      model: anthropic/m-new\n");
		const { db, modelStore } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } }, [
			{ model_id: "db-id-m", model_name: "m", litellm_params: { model: "anthropic/m-old" }, model_info: {} },
		]);
		await yamlConfigDiffService.initialize(db as never);
		const app = buildApp(db, makeRouter());

		const res = await request(app).post("/config/yaml_diff/accept").send({ section: "model_list", key: "m" });
		expect(res.status).toBe(200);
		const row = modelStore.get("db-id-m")!;
		expect(row["litellm_params"]).toEqual({ model: "anthropic/m-new" });
		expect(modelStore.size).toBe(1);
	});

	it("未知差异项 → 404；非法 section → 400", async () => {
		loadYamlFromString("general_settings:\n  a: 1\n");
		const { db } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		await yamlConfigDiffService.initialize(db as never);
		const app = buildApp(db);

		const notFound = await request(app).post("/config/yaml_diff/accept").send({ section: "general_settings", key: "nope" });
		expect(notFound.status).toBe(404);
		const badSection = await request(app).post("/config/yaml_diff/accept").send({ section: "model_lust", key: "a" });
		expect(badSection.status).toBe(400);
	});
});

describe("POST /config/yaml_diff/resolve", () => {
	it("写 config_yaml_snapshot 快照并清空 pending", async () => {
		loadYamlFromString("general_settings:\n  a: 1\n");
		const { db, configStore } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		await yamlConfigDiffService.initialize(db as never);
		expect(yamlConfigDiffService.hasPending()).toBe(true);
		const app = buildApp(db);

		const res = await request(app).post("/config/yaml_diff/resolve").send({});
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("success");
		expect(res.body.snapshot.hash).toBe(computeCurrentYamlSnapshot()!.hash);
		expect(yamlConfigDiffService.hasPending()).toBe(false);
		const stored = configStore.get(CONFIG_YAML_SNAPSHOT_PARAM) as { hash: string };
		expect(stored.hash).toBe(res.body.snapshot.hash);
	});
});
