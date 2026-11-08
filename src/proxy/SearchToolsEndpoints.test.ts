/**
 * WebUI 搜索工具与用量端点契约测试
 *
 * 锁定 Dashboard 依赖的响应形状：
 * - /search_tools/list 返回 { search_tools } 且 config 条目带 is_from_config
 * - /search_tools/ui/available_providers 返回 { providers: [{ provider_name, ui_friendly_name }] }
 * - POST /search_tools/test_connection 返回 { status, message } 而不抛 500
 * - /user/available_users 返回 total_users/total_users_used 等计数字段
 * - /health/license 返回 has_license/limits 字段
 */
import express from "express";
import request from "supertest";
import type { ServiceConfig } from "../core/config";

let runtimeConfig: ServiceConfig;
jest.mock("../core/config", () => ({
	...jest.requireActual("../core/config"),
	getConfig: () => runtimeConfig,
}));

import { validateAndTransform } from "../core/config";
import { registerSearchToolsRoutes } from "./SearchToolsEndpoints";
import { registerWebUiSupportRoutes } from "./WebUiSupportEndpoints";

/** config 中已有一条只读搜索工具。 */
function makeConfig(): ServiceConfig {
	return validateAndTransform({
		general_settings: { master_key: "sk-test-master-key" },
		router_settings: {
			search_tools: [{ search_tool_name: "google-pse", litellm_params: { search_provider: "google_pse" } }],
		},
	});
}

/** 只实现计数查询与写入的 mock db。 */
function makeCountDb(rows: unknown[] = [{ value: 3 }]) {
	return { select: () => ({ from: () => Promise.resolve(rows) }) };
}

/**
 * @param db - 注入的 mock db
 */
function makeApp(db: unknown, withSearchTools = false): express.Express {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_id: "user-1" } as never;
		next();
	});
	const router = express.Router();
	registerWebUiSupportRoutes(router, runtimeConfig, db as never);
	if (withSearchTools) {
		registerSearchToolsRoutes(router, db as never);
	}
	app.use(router);
	return app;
}

beforeEach(() => {
	runtimeConfig = makeConfig();
});

describe("search tools dashboard endpoints", () => {
	it("lists config search tools with is_from_config so the table can render them read-only", async () => {
		const response = await request(makeApp(makeCountDb([]), true))
			.get("/search_tools/list")
			.expect(200);
		const body = response.body as { search_tools: Array<Record<string, unknown>> };
		expect(body.search_tools).toHaveLength(1);
		expect(body.search_tools[0]).toMatchObject({
			search_tool_name: "google-pse",
			litellm_params: { search_provider: "google_pse" },
			is_from_config: true,
		});
	});

	it("advertises providers the proxy can execute and reports connection errors as status=error", async () => {
		const app = makeApp(makeCountDb([]), true);
		const providers = await request(app).get("/search_tools/ui/available_providers").expect(200);
		expect(providers.body).toEqual({ providers: [{ provider_name: "google_pse", ui_friendly_name: "Google PSE" }] });

		const response = await request(app)
			.post("/search_tools/test_connection")
			.send({ litellm_params: { search_provider: "google_pse" } })
			.expect(200);
		expect(response.body).toMatchObject({ status: "error" });
		expect(String((response.body as { message: string }).message)).toContain("API Key");
	});

	it("rejects invalid search tool payloads with 400 instead of 500", async () => {
		await request(makeApp(makeCountDb([]), true)).post("/search_tools").send({ search_tool: {} }).expect(400);
	});
});

describe("usage indicator endpoints", () => {
	it("returns user and team counts in the shape the dashboard parses", async () => {
		const response = await request(makeApp(makeCountDb([{ value: 3 }])))
			.get("/user/available_users")
			.expect(200);
		expect(response.body).toEqual({
			total_users: null,
			total_users_used: 3,
			total_users_remaining: null,
			total_teams: null,
			total_teams_used: 3,
			total_teams_remaining: null,
		});
	});

	it("returns a license payload without limits instead of the legacy stub", async () => {
		const response = await request(makeApp(makeCountDb())).get("/health/license").expect(200);
		expect(response.body).toEqual({
			has_license: false,
			license_type: null,
			expiration_date: null,
			allowed_features: [],
			limits: { max_users: null, max_teams: null },
		});
	});
});
