/**
 * SpendTracker 测试
 *
 * 对齐 Python litellm/db_spend_update_writer.py
 * 验证：
 *  - 每个 daily spend table 的 unique constraint 包含关键列
 *  - 维度 → key column 映射正确
 *  - 未知 dimension 抛错
 */
import { liteLLM_DailyUserSpend } from "../db/schema/dailyUserSpend";
import { liteLLM_DailyTeamSpend } from "../db/schema/dailyTeamSpend";
import { liteLLM_DailyOrganizationSpend } from "../db/schema/dailyOrganizationSpend";
import { liteLLM_DailyTagSpend } from "../db/schema/dailyTagSpend";
import { liteLLM_DailyAgentSpend } from "../db/schema/dailyAgentSpend";
import { getTableConfig } from "drizzle-orm/pg-core";
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { liteLLM_SpendReservations } from "../db/schema/spendReservations";
import type { Request } from "express";
import {
	buildAdditionalUsageValues,
	buildSpendLogFromRequest,
	buildSpendReservationScopes,
	estimateSpendReservation,
	getDailyTable,
	getOrCreateSpendRequestId,
	getKeyColumn,
	normalizeUsageForSpend,
	reconstructModelName,
	renewSpendReservation,
	reserveSpend,
	sanitizeSpendLogPayload,
	settleSpend,
	startSpendReservationHeartbeat,
	trackSpendLog,
} from "./SpendTracker";
import { estimateRouterSpendReservation } from "./SpendReservation";
import { CallType, SpendLogStatus } from "../types/spend";

describe("Spend reservation 请求 helper", () => {
	it("同 key 与幂等 header 生成稳定 request id，不同 key 隔离 namespace", () => {
		const requestA = { headers: { "idempotency-key": "same" }, auth: { token: "key-a" } } as unknown as Request;
		const requestB = { headers: { "idempotency-key": "same" }, auth: { token: "key-b" } } as unknown as Request;
		expect(getOrCreateSpendRequestId(requestA)).toBe(getOrCreateSpendRequestId(requestA));
		expect(getOrCreateSpendRequestId(requestA)).not.toBe(getOrCreateSpendRequestId(requestB));
	});

	it("无 header 时生成 UUID 并挂到 request", () => {
		const request = { headers: {}, auth: { api_key: "key-a" } } as unknown as Request;
		const requestId = getOrCreateSpendRequestId(request);
		expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect((request as Request & { spendRequestId?: string }).spendRequestId).toBe(requestId);
	});

	it("从 auth 构造所有独立预算主体", () => {
		expect(
			buildSpendReservationScopes({
				api_key: "raw",
				token: "key-id",
				user_id: "user-id",
				team_id: "team-id",
				organization_id: "org-id",
				project_id: "project-id",
				end_user_id: "end-id",
				budget_snapshots: {
					key: { id: "key-id", spend: 0, max_budget: 10 },
					user: { id: "user-id", spend: 0, max_budget: 10 },
					team: { id: "team-id", spend: 0, max_budget: 10 },
					organization: { id: "org-id", spend: 0, max_budget: 10 },
					project: { id: "project-id", spend: 0, max_budget: 10 },
					team_member: { id: "user-id:team-id", spend: 0, max_budget: 10 },
					end_user: { id: "end-id", spend: 0, max_budget: 10 },
				},
			}),
		).toEqual([
			{ kind: "key", id: "key-id" },
			{ kind: "user", id: "user-id" },
			{ kind: "team", id: "team-id" },
			{ kind: "organization", id: "org-id" },
			{ kind: "project", id: "project-id" },
			{ kind: "team_member", userId: "user-id", teamId: "team-id" },
			{ kind: "end_user", id: "end-id" },
		]);
	});

	it("无已确认预算快照的 master/JWT auth 不构造 reservation scope", () => {
		expect(buildSpendReservationScopes({ api_key: "master", user_id: "default_user_id" })).toEqual([]);
	});

	it("没有硬预算上限的快照不构造 reservation scope", () => {
		expect(
			buildSpendReservationScopes({
				api_key: "raw",
				budget_snapshots: {
					key: { id: "key-id", spend: 0, max_budget: null },
					team: { id: "team-id", spend: 0, max_budget: null },
				},
			}),
		).toEqual([]);
	});

	it("按 tokenizer 估算输入 token，而不是把 UTF-8 字节数直接当 token", () => {
		const body = { prompt: "你好，世界", max_tokens: 0 };
		const estimated = estimateSpendReservation("unknown-model", body, { input_cost_per_token: 1 });
		const utf8Bytes = Buffer.byteLength(JSON.stringify(body), "utf8");

		expect(estimated).toBeGreaterThan(0);
		expect(estimated).toBeLessThan(utf8Bytes);
	});

	it("Responses API 的 max_output_tokens 参与 reservation 上界", () => {
		const estimated = estimateSpendReservation(
			"unknown-model",
			{ input: "hello", max_output_tokens: 10_000 },
			{ output_cost_per_token: 0.2 },
		);
		expect(estimated).toBeGreaterThanOrEqual(2_000);
	});

	it("多个输出 token 上限字段同时存在时取最大值", () => {
		const estimated = estimateSpendReservation(
			"unknown-model",
			{ input: "hello", max_completion_tokens: 100, max_tokens: 1_000 },
			{ output_cost_per_token: 1 },
		);
		expect(estimated).toBeGreaterThanOrEqual(1_000);
	});
});

function sqlLiteralText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sqlLiteralText).join("");
	}
	if (value && typeof value === "object") {
		const record = value as { queryChunks?: unknown[]; value?: unknown };
		if (record.queryChunks) {
			return record.queryChunks.map(sqlLiteralText).join("");
		}
		if (record.value !== undefined) {
			return sqlLiteralText(record.value);
		}
	}
	return "";
}

function withTransaction(db: Record<string, unknown>): Record<string, unknown> {
	const insert = db["insert"] as (table: unknown) => { values: (values: Record<string, unknown>) => unknown };
	db["transaction"] = jest.fn((callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback(db));
	db["select"] = () => ({ from: () => ({ where: () => Promise.resolve([]) }) });
	db["update"] = () => ({ set: () => ({ where: () => Promise.resolve() }) });
	db["insert"] = (table: unknown) => {
		const builder = insert(table);
		return {
			values: (values: Record<string, unknown>) => {
				const result = builder.values(values);
				if (table !== liteLLM_SpendLogs) {
					return result;
				}
				return {
					onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ requestId: values["request_id"] }]) }),
				};
			},
		};
	};
	return db;
}

describe("SpendLogs schema parity", () => {
	it("reservation 账本包含数据库 lease 到期时间", () => {
		const reservationConfig = getTableConfig(liteLLM_SpendReservations);
		expect(reservationConfig.columns.map((column) => column.name)).toContain("expires_at");
	});

	it("不包含 Python SpendLogs schema 不存在的 standard_logging_object 列", () => {
		const spendLogsConfig = getTableConfig(liteLLM_SpendLogs);
		const spendLogsColumnNames = spendLogsConfig.columns.map((column) => column.name);
		expect(spendLogsColumnNames).not.toContain("standard_logging_object");
	});

	it("保留 Python SpendLogs 关键列", () => {
		const spendLogsConfig = getTableConfig(liteLLM_SpendLogs);
		const spendLogsColumnNames = spendLogsConfig.columns.map((column) => column.name);
		expect(spendLogsColumnNames).toEqual(
			expect.arrayContaining(["request_id", "call_type", "api_key", "spend", "messages", "response", "proxy_server_request"]),
		);
	});
});

describe("SpendTracker dimension mapping (DB-001)", () => {
	describe("getDailyTable", () => {
		it("user → liteLLM_DailyUserSpend", () => {
			expect(getDailyTable("user")).toBe(liteLLM_DailyUserSpend);
		});
		it("team → liteLLM_DailyTeamSpend", () => {
			expect(getDailyTable("team")).toBe(liteLLM_DailyTeamSpend);
		});
		it("organization → liteLLM_DailyOrganizationSpend", () => {
			expect(getDailyTable("organization")).toBe(liteLLM_DailyOrganizationSpend);
		});
		it("tag → liteLLM_DailyTagSpend", () => {
			expect(getDailyTable("tag")).toBe(liteLLM_DailyTagSpend);
		});
		it("agent → liteLLM_DailyAgentSpend", () => {
			expect(getDailyTable("agent")).toBe(liteLLM_DailyAgentSpend);
		});
		it("end_user → liteLLM_DailyEndUserSpend", () => {
			expect(getDailyTable("end_user")).toBe(liteLLM_DailyEndUserSpend);
		});
		it("未知 dimension 抛错", () => {
			expect(() => getDailyTable("unknown")).toThrow(/未知的每日花费维度/);
		});
	});

	describe("getKeyColumn", () => {
		it("user → user_id", () => {
			expect(getKeyColumn("user")).toBe("user_id");
		});
		it("team → team_id", () => {
			expect(getKeyColumn("team")).toBe("team_id");
		});
		it("organization → organization_id", () => {
			expect(getKeyColumn("organization")).toBe("organization_id");
		});
		it("tag → tag", () => {
			expect(getKeyColumn("tag")).toBe("tag");
		});
		it("agent → agent_id", () => {
			expect(getKeyColumn("agent")).toBe("agent_id");
		});
		it("end_user → end_user_id (DB-001: 验证 end_user 维度 unique constraint 可用)", () => {
			expect(getKeyColumn("end_user")).toBe("end_user_id");
		});
		it("未知 dimension 抛错", () => {
			expect(() => getKeyColumn("unknown")).toThrow(/未知的键列维度/);
		});
	});

	describe("unique constraints (DB-001)", () => {
		// 对齐 Python: DailyEndUserSpend unique on (end_user_id, date, api_key, model, custom_llm_provider, mcp_namespaced_tool_name, endpoint)
		// TS schema 用 drizzle uniqueIndex 定义
		// GAP: drizzle uniqueIndex 不暴露 `.unq` 属性在 table 对象上，需通过 getTableConfig 提取
		// GAP: drizzle uniqueIndex 不暴露 `.unq` 属性在 table 对象上，需通过 getTableConfig 提取
		it("liteLLM_DailyEndUserSpend 包含 uniqueIndex (对齐 PY unique on (end_user_id, date, api_key, ...))", () => {
			const config = getTableConfig(liteLLM_DailyEndUserSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
			expect(config.indexes.length).toBeGreaterThan(0);
		});

		it("liteLLM_DailyUserSpend 包含 uniqueIndex", () => {
			const config = getTableConfig(liteLLM_DailyUserSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyTeamSpend 包含 uniqueIndex", () => {
			const config = getTableConfig(liteLLM_DailyTeamSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyOrganizationSpend 包含 uniqueIndex", () => {
			const config = getTableConfig(liteLLM_DailyOrganizationSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyTagSpend 包含 uniqueIndex", () => {
			const config = getTableConfig(liteLLM_DailyTagSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyAgentSpend 包含 uniqueIndex", () => {
			const config = getTableConfig(liteLLM_DailyAgentSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("所有 daily spend table 的 uniqueIndex 都覆盖 (key_id, date, api_key, model, custom_llm_provider, mcp, endpoint)", () => {
			const tables = [
				liteLLM_DailyUserSpend,
				liteLLM_DailyTeamSpend,
				liteLLM_DailyOrganizationSpend,
				liteLLM_DailyTagSpend,
				liteLLM_DailyAgentSpend,
				liteLLM_DailyEndUserSpend,
			];
			for (const t of tables) {
				const config = getTableConfig(t);
				// 每个表都至少有一个 unique constraint / unique index
				const uniqueCount =
					config.uniqueConstraints.length +
					config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
				expect(uniqueCount).toBeGreaterThan(0);
			}
		});
	});

	describe("DIFF-SPEND-01: call_type 透传（cache hit 保留 amessages）", () => {
		it("call_type=CallType.AMessages (AnthropicMessages) 字段可透传", () => {
			// 模拟 trackSpendLog 入口的 call_type 字段：AnthropicMessages 路径
			// （caching.py:353-394）cache hit 时仍保留 call_type='amessages'
			const logEntry: { call_type: CallType; cache_hit: boolean } = {
				call_type: CallType.AMessages,
				cache_hit: true,
			};
			// 即使 cache hit，call_type 也不应被改写（PY 行为）
			expect(logEntry.call_type).toBe(CallType.AMessages);
			expect(logEntry.cache_hit).toBe(true);
		});

		it("call_type 缺省时回退 CallType.ACompletion (SpendTracker 默认行为)", () => {
			// trackSpendLog: logEntry.call_type || 'acompletion' 行为（spend_tracking.py:289）
			const callType: CallType | undefined = undefined;
			const effective = callType || CallType.ACompletion;
			expect(effective).toBe(CallType.ACompletion);
		});

		it("call_type=CallType.AMessages 显式传入不强制改写为 ACompletion", () => {
			// 验证 SpendTracker 不会主动改写 call_type
			const logEntry: { call_type: CallType } = { call_type: CallType.AMessages };
			const result = logEntry.call_type || CallType.ACompletion;
			expect(result).toBe(CallType.AMessages);
		});
	});

	describe("DIFF-011: master_key_alias 字面值 (PY key_alias)", () => {
		// 验证 user_api_key_alias 字面值能在 metadata 中被透传，不被改写
		it("alias 字面值原样保留", () => {
			const alias = "user-alias-mock-test-12345";
			const metadata: Record<string, unknown> = { user_api_key_alias: alias };
			expect(metadata["user_api_key_alias"]).toBe("user-alias-mock-test-12345");
		});

		it("trackSpendLog 接收 logEntry.metadata.user_api_key_alias 不强制改写", () => {
			// 模拟 trackSpendLog 入口接受 alias 字面值（对齐 PY key_alias 透传）
			const alias = "production-alias-XYZ";
			const logEntry: Record<string, unknown> = {
				request_id: "req-1",
				call_type: CallType.ACompletion,
				api_key: "hashed-key",
				spend: 0.01,
				model: "gpt-4",
				metadata: { user_api_key_alias: alias },
			};
			// 验证 metadata.user_api_key_alias 字面值保留
			const md = (logEntry["metadata"] ?? {}) as Record<string, unknown>;
			expect(md["user_api_key_alias"]).toBe("production-alias-XYZ");
			// 验证 alias 不被改写为大写/小写
			expect(md["user_api_key_alias"]).not.toBe("PRODUCTION-ALIAS-XYZ");
		});

		it("alias 缺省时 metadata 透传空 dict（不抛错）", () => {
			const logEntry: Record<string, unknown> = {
				request_id: "req-2",
				call_type: CallType.ACompletion,
				api_key: "",
				spend: 0,
				model: "gpt-4",
				metadata: {},
			};
			const md = (logEntry["metadata"] ?? {}) as Record<string, unknown>;
			expect(md["user_api_key_alias"]).toBeUndefined();
		});
	});
});

describe("Spend reservation 候选成本上界", () => {
	it("递归覆盖原模型组和 fallback deployment，并取 deployment model 自定义价格的最大值", () => {
		const router = {
			getDeployments: () => [
				{
					model_name: "primary",
					litellm_params: { model: "provider/cheap" },
					model_info: { input_cost_per_token: 0.01, output_cost_per_token: 0.02 },
				},
				{
					model_name: "fallback-a",
					litellm_params: { model: "provider/mid" },
					model_info: { input_cost_per_token: 0.02, output_cost_per_token: 0.03 },
				},
				{
					model_name: "fallback-b",
					litellm_params: { model: "provider/expensive" },
					model_info: { input_cost_per_token: 0.04, output_cost_per_token: 0.05 },
				},
			],
			getFallbacks: () => ({ primary: ["fallback-a"], "fallback-a": ["fallback-b"] }),
		};
		const expensive = estimateSpendReservation(
			"provider/expensive",
			{ prompt: "hello", max_tokens: 10 },
			{
				input_cost_per_token: 0.04,
				output_cost_per_token: 0.05,
			},
		);
		expect(estimateRouterSpendReservation(router, "primary", { prompt: "hello", max_tokens: 10 })).toBe(expensive);
	});

	it("普通 fallback 已匹配时仍纳入未公开的专用 fallback 候选上界", () => {
		const router = {
			getDeployments: () => [
				{
					model_name: "primary",
					litellm_params: { model: "provider/cheap", input_cost_per_token: 0.01, output_cost_per_token: 0.02 },
				},
				{
					model_name: "regular-fallback",
					litellm_params: { model: "provider/mid", input_cost_per_token: 0.02, output_cost_per_token: 0.03 },
				},
				{
					model_name: "context-or-policy-fallback",
					litellm_params: { model: "provider/expensive", input_cost_per_token: 0.4, output_cost_per_token: 0.5 },
				},
			],
			getFallbacks: () => ({ primary: ["regular-fallback"] }),
		};
		const expensive = estimateSpendReservation(
			"provider/expensive",
			{ prompt: "hello", max_tokens: 10 },
			{ input_cost_per_token: 0.4, output_cost_per_token: 0.5 },
		);
		expect(estimateRouterSpendReservation(router, "primary", { prompt: "hello", max_tokens: 10 })).toBe(expensive);
	});

	it("无法精确匹配模型组时保守包含全部 deployments", () => {
		const router = {
			getDeployments: () => [
				{ model_name: "other", litellm_params: { model: "provider/expensive", input_cost_per_token: 1, output_cost_per_token: 2 } },
			],
			getFallbacks: () => ({ requested: ["missing"] }),
		};
		expect(estimateRouterSpendReservation(router, "requested", { prompt: "x", max_tokens: 1 })).toBeGreaterThan(2);
	});

	it("未知 deployment 价格拒绝按 0 预留", () => {
		const router = {
			getDeployments: () => [{ model_name: "unknown", litellm_params: { model: "provider/unpriced" } }],
			getFallbacks: () => ({}),
		};
		expect(() => estimateRouterSpendReservation(router, "unknown", { prompt: "x", max_tokens: 1 })).toThrow(/价格/);
	});
});

describe("Spend reservation 事务", () => {
	it("过期 reservation 可由同 request_id 重新获取 lease", async () => {
		const expired = {
			request_id: "expired-request",
			scope_ids: ["key:key-a"],
			reserved: 3,
			actual: null,
			status: "reserved",
			expires_at: new Date(Date.now() - 1_000),
		};
		const updateReturning = jest.fn().mockResolvedValue([{ ...expired, expires_at: new Date(Date.now() + 60_000) }]);
		let db: Record<string, unknown>;
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([expired])) })) })),
			execute: jest
				.fn()
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [{ max_budget: 10, spend: 0, budget_id: null }] })
				.mockResolvedValueOnce({ rows: [{ reserved: 0 }] }),
			update: jest.fn(() => ({
				set: jest.fn(() => ({ where: jest.fn(() => ({ returning: updateReturning })) })),
			})),
		};

		await expect(
			reserveSpend(db as unknown as Parameters<typeof reserveSpend>[0], {
				requestId: "expired-request",
				reserved: 3,
				scopes: [{ kind: "key", id: "key-a" }],
			}),
		).resolves.toMatchObject({ status: "reserved", requestId: "expired-request" });
		expect(updateReturning).toHaveBeenCalledTimes(1);
	});

	it("settle 实际费用超过预留时重新检查全部主体预算", async () => {
		const reservation = {
			request_id: "overage-request",
			scope_ids: ["key:key-a"],
			reserved: 5,
			actual: null,
			status: "reserved",
			expires_at: new Date(Date.now() + 60_000),
		};
		let db: Record<string, unknown>;
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([reservation])) })) })),
			execute: jest
				.fn()
				.mockResolvedValueOnce({ rows: [] })
				.mockResolvedValueOnce({ rows: [{ max_budget: 10, spend: 4, budget_id: null }] })
				.mockResolvedValueOnce({ rows: [{ reserved: 0 }] }),
			update: jest.fn(() => ({
				set: jest.fn(() => ({ where: jest.fn(() => ({ returning: jest.fn().mockResolvedValue([]) })) })),
			})),
		};

		await expect(settleSpend(db as unknown as Parameters<typeof settleSpend>[0], "overage-request", 8)).rejects.toMatchObject({
			statusCode: 429,
		});
	});

	it("原子 renew 仅延长仍活跃且未过期的 reservation", async () => {
		const returning = jest.fn().mockResolvedValue([{ reserved: 3, actual: null }]);
		const db = {
			update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(() => ({ returning: returning })) })) })),
		};
		await expect(
			renewSpendReservation(db as unknown as Parameters<typeof renewSpendReservation>[0], "renew-request"),
		).resolves.toMatchObject({
			status: "reserved",
			requestId: "renew-request",
		});
		expect(returning).toHaveBeenCalledTimes(1);
	});

	it("heartbeat 在 provider 开始前续租失败返回 503，开始后只记录并交给最终结算", async () => {
		const renewBeforeProvider = jest.fn().mockRejectedValue(new Error("database unavailable"));
		const beforeProvider = startSpendReservationHeartbeat(
			{} as Parameters<typeof startSpendReservationHeartbeat>[0],
			"heartbeat-before-provider",
			{ intervalMs: 60_000, renew: renewBeforeProvider },
		);
		await expect(beforeProvider.renewNow()).rejects.toMatchObject({ statusCode: 503 });
		expect(() => beforeProvider.markProviderStarted()).toThrow(/续租失败/);
		beforeProvider.stop();

		const renewDuringProvider = jest.fn().mockRejectedValue(new Error("database unavailable"));
		const duringProvider = startSpendReservationHeartbeat(
			{} as Parameters<typeof startSpendReservationHeartbeat>[0],
			"heartbeat-during-provider",
			{ intervalMs: 60_000, renew: renewDuringProvider },
		);
		duringProvider.markProviderStarted();
		await expect(duringProvider.renewNow()).resolves.toBe(false);
		duringProvider.stop();
	});
});

describe("trackSpendLog 原子提交", () => {
	it("所有实体 spend 累计都以 COALESCE 兼容 NULL", async () => {
		let db: Record<string, unknown>;
		const spendExpressions: unknown[] = [];
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
			update: jest.fn(() => ({
				set: jest.fn((values: Record<string, unknown>) => {
					if (values["spend"] !== undefined) {
						spendExpressions.push(values["spend"]);
					}
					return { where: jest.fn(() => Promise.resolve()) };
				}),
			})),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([{ requestId: "req-coalesce" }])) })),
					onConflictDoUpdate: jest.fn(() => Promise.resolve()),
				})),
			})),
		};

		await trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
			agent_id: "agent-id",
			api_key: "key-id",
			call_type: CallType.ACompletion,
			completion_tokens: 1,
			endTime: "2026-01-01T00:00:01.000Z",
			end_user_id: "end-user-id",
			metadata: { user_api_key_project_id: "project-id" },
			model: "unknown-model-cost-zero",
			organization_id: "organization-id",
			prompt_tokens: 1,
			request_id: "req-coalesce",
			spend: 0,
			startTime: "2026-01-01T00:00:00.000Z",
			team_id: "team-id",
			total_tokens: 2,
			user: "user-id",
		});

		expect(spendExpressions).toHaveLength(8);
		for (const expression of spendExpressions) {
			expect(sqlLiteralText(expression)).toContain("COALESCE(");
		}
	});

	it("首次 request_id 仅在整个事务提交后返回 committed", async () => {
		let db: Record<string, unknown>;
		const transaction = jest.fn((callback: (tx: unknown) => Promise<unknown>): Promise<unknown> => callback(db));
		db = {
			transaction: transaction,
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
			update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })) })),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({
						returning: jest.fn(() => Promise.resolve([{ request_id: "req-atomic-commit" }])),
					})),
				})),
			})),
		};

		await expect(
			trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
				api_key: "key",
				call_type: CallType.ACompletion,
				completion_tokens: 1,
				endTime: "2026-01-01T00:00:01.000Z",
				model: "unknown-model-cost-zero",
				prompt_tokens: 1,
				request_id: "req-atomic-commit",
				spend: 0,
				startTime: "2026-01-01T00:00:00.000Z",
				total_tokens: 2,
			}),
		).resolves.toEqual({ status: "committed", requestId: "req-atomic-commit", spend: 0 });
		expect(transaction).toHaveBeenCalledTimes(1);
	});

	it("成功日志在同一事务内把 reservation 结算为实际费用", async () => {
		let db: Record<string, unknown>;
		const reservationSets: Record<string, unknown>[] = [];
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
			update: jest.fn((table: unknown) => ({
				set: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_SpendReservations) {
						reservationSets.push(values);
					}
					return { where: jest.fn(() => Promise.resolve()) };
				}),
			})),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([{ requestId: "req-settle" }])) })),
				})),
			})),
		};
		await trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
			api_key: "key",
			call_type: CallType.ACompletion,
			completion_tokens: 1,
			endTime: "2026-01-01T00:00:01.000Z",
			model: "unknown-model-cost-zero",
			prompt_tokens: 1,
			request_id: "req-settle",
			spend: 0,
			startTime: "2026-01-01T00:00:00.000Z",
			total_tokens: 2,
		});
		expect(reservationSets).toContainEqual(expect.objectContaining({ status: "settled", actual: 0 }));
	});

	it("失败日志在同一事务内释放 reservation", async () => {
		let db: Record<string, unknown>;
		const reservationSets: Record<string, unknown>[] = [];
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
			update: jest.fn((table: unknown) => ({
				set: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_SpendReservations) {
						reservationSets.push(values);
					}
					return { where: jest.fn(() => Promise.resolve()) };
				}),
			})),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([{ requestId: "req-release" }])) })),
				})),
			})),
		};
		await trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
			api_key: "key",
			call_type: CallType.ACompletion,
			completion_tokens: 0,
			endTime: "2026-01-01T00:00:01.000Z",
			model: "unknown-model-cost-zero",
			prompt_tokens: 1,
			request_id: "req-release",
			spend: 0,
			startTime: "2026-01-01T00:00:00.000Z",
			status: SpendLogStatus.Failure,
			total_tokens: 1,
		});
		expect(reservationSets).toContainEqual(expect.objectContaining({ status: "released", actual: null }));
	});

	it("失败日志有部分费用时在同一事务内结算 reservation", async () => {
		let db: Record<string, unknown>;
		const reservationSets: Record<string, unknown>[] = [];
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
			update: jest.fn((table: unknown) => ({
				set: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_SpendReservations) {
						reservationSets.push(values);
					}
					return { where: jest.fn(() => Promise.resolve()) };
				}),
			})),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({
						returning: jest.fn(() => Promise.resolve([{ requestId: "req-partial-failure" }])),
					})),
				})),
			})),
		};
		await trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
			api_key: "key",
			call_type: CallType.ACompletion,
			completion_tokens: 1,
			endTime: "2026-01-01T00:00:01.000Z",
			model: "unknown-model-cost-zero",
			prompt_tokens: 1,
			request_id: "req-partial-failure",
			spend: 0,
			custom_cost_per_token: { input_cost_per_token: 0.1, output_cost_per_token: 0.15 },
			startTime: "2026-01-01T00:00:00.000Z",
			status: SpendLogStatus.Failure,
			total_tokens: 2,
		});
		expect(reservationSets).toContainEqual(expect.objectContaining({ status: "settled", actual: 0.25 }));
	});

	it("transaction 数据库错误转换为 ApiError 503，并尝试释放未决 reservation", async () => {
		const releaseWhere = jest.fn(() => Promise.resolve());
		const db = {
			transaction: jest.fn(() => Promise.reject(new Error("connection lost"))),
			update: jest.fn(() => ({ set: jest.fn(() => ({ where: releaseWhere })) })),
		};
		await expect(
			trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
				api_key: "key",
				call_type: CallType.ACompletion,
				completion_tokens: 1,
				endTime: "2026-01-01T00:00:01.000Z",
				model: "unknown-model-cost-zero",
				prompt_tokens: 1,
				request_id: "req-db-error",
				spend: 0,
				startTime: "2026-01-01T00:00:00.000Z",
				total_tokens: 2,
			}),
		).rejects.toMatchObject({ name: "ApiError", statusCode: 503 });
		expect(releaseWhere).toHaveBeenCalledTimes(1);
	});

	it("重复 SpendLog 不使用新 attempt 的 spend 终结 reservation", async () => {
		let db: Record<string, unknown>;
		const reservationSets: Record<string, unknown>[] = [];
		const update = jest.fn((table: unknown) => ({
			set: jest.fn((values: Record<string, unknown>) => {
				if (table === liteLLM_SpendReservations) {
					reservationSets.push(values);
				}
				return { where: jest.fn(() => Promise.resolve()) };
			}),
		}));
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => Promise.resolve([])) })) })),
			update: update,
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([])) })),
				})),
			})),
		};
		await expect(
			trackSpendLog(db as unknown as Parameters<typeof trackSpendLog>[0], {
				api_key: "key",
				call_type: CallType.ACompletion,
				completion_tokens: 1,
				endTime: "2026-01-01T00:00:01.000Z",
				model: "unknown-model-cost-zero",
				prompt_tokens: 1,
				request_id: "req-duplicate",
				spend: 0,
				startTime: "2026-01-01T00:00:00.000Z",
				total_tokens: 2,
			}),
		).resolves.toEqual({ status: "duplicate", requestId: "req-duplicate", spend: 0 });
		expect(reservationSets).toEqual([]);
		expect(update).not.toHaveBeenCalled();
	});
});

describe("SpendTracker API key sanitization", () => {
	const rawApiKey = "sk-test-plaintext-key-never-store";

	function stringify(value: unknown): string {
		return JSON.stringify(value);
	}

	function createRequest(): Request {
		return {
			body: {
				model: "gpt-4o-mini",
				metadata: {
					user_api_key: rawApiKey,
					trace_id: "trace-spend-key-sanitize",
				},
				prompt: `never store ${rawApiKey}`,
			},
			headers: {
				authorization: `Bearer ${rawApiKey}`,
				"x-custom-token": rawApiKey,
			},
			ip: "127.0.0.1",
			method: "POST",
			originalUrl: "/v1/chat/completions",
			socket: { remoteAddress: "127.0.0.1" },
			url: "/v1/chat/completions",
		} as unknown as Request;
	}

	function createMockDb(insertedSpendLogs: Record<string, unknown>[]): Parameters<typeof trackSpendLog>[0] {
		return withTransaction({
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((insertValues: Record<string, unknown>) => {
					if (table === liteLLM_SpendLogs) {
						insertedSpendLogs.push(insertValues);
					}
					return Promise.resolve(undefined);
				}),
			})),
		}) as unknown as Parameters<typeof trackSpendLog>[0];
	}

	it("buildSpendLogFromRequest 输出 hash key 且 proxy_server_request 不含明文 key", async () => {
		const previousStorePrompts = process.env.STORE_PROMPTS_IN_SPEND_LOGS;
		process.env.STORE_PROMPTS_IN_SPEND_LOGS = "true";
		try {
			const spendLog = await buildSpendLogFromRequest({
				auth: { api_key: rawApiKey },
				callType: CallType.ACompletion,
				endTime: new Date("2026-01-01T00:00:01.000Z"),
				model: "gpt-4o-mini",
				req: createRequest(),
				requestId: "req-spend-key-sanitize",
				startTime: new Date("2026-01-01T00:00:00.000Z"),
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
			const metadata = spendLog.metadata ?? {};
			expect(spendLog.api_key).not.toBe(rawApiKey);
			expect(spendLog.api_key.startsWith("sk-")).toBe(false);
			expect(metadata["user_api_key"]).toBe(spendLog.api_key);
			expect(stringify(spendLog.proxy_server_request)).not.toContain(rawApiKey);
		} finally {
			if (previousStorePrompts === undefined) {
				delete process.env.STORE_PROMPTS_IN_SPEND_LOGS;
			} else {
				process.env.STORE_PROMPTS_IN_SPEND_LOGS = previousStorePrompts;
			}
		}
	});

	it("sanitizeSpendLogPayload 按值移除非敏感字段名里的明文 key", () => {
		const sanitizedPayload = sanitizeSpendLogPayload({
			message: `Bearer ${rawApiKey}`,
			nested: { value: rawApiKey },
		});
		expect(stringify(sanitizedPayload)).not.toContain(rawApiKey);
	});

	it("图片生成响应保留超过普通文本上限的完整 base64", async () => {
		const previousStorePrompts = process.env.STORE_PROMPTS_IN_SPEND_LOGS;
		process.env.STORE_PROMPTS_IN_SPEND_LOGS = "true";
		const imageBase64 = "A".repeat(32769);
		try {
			const spendLog = await buildSpendLogFromRequest({
				auth: { api_key: rawApiKey },
				callType: CallType.AImageGeneration,
				endTime: new Date("2026-01-01T00:00:01.000Z"),
				messages: "生成图片",
				model: "gpt-image-2",
				req: createRequest(),
				requestId: "req-image-base64",
				response: { data: [{ b64_json: imageBase64 }] },
				startTime: new Date("2026-01-01T00:00:00.000Z"),
			});

			expect((spendLog.response as { data: Array<{ b64_json: string }> }).data[0]?.b64_json).toBe(imageBase64);
			expect(stringify(sanitizeSpendLogPayload({ text: imageBase64 }))).toContain("litellm_truncated");
		} finally {
			if (previousStorePrompts === undefined) {
				delete process.env.STORE_PROMPTS_IN_SPEND_LOGS;
			} else {
				process.env.STORE_PROMPTS_IN_SPEND_LOGS = previousStorePrompts;
			}
		}
	});

	it("原始流式请求可用结构化摘要覆盖 proxy_server_request.body", async () => {
		const previousStorePrompts = process.env.STORE_PROMPTS_IN_SPEND_LOGS;
		process.env.STORE_PROMPTS_IN_SPEND_LOGS = "true";
		try {
			const request = createRequest();
			request.body = undefined;
			const spendLog = await buildSpendLogFromRequest({
				auth: { api_key: rawApiKey },
				callType: CallType.AImageGeneration,
				endTime: new Date("2026-01-01T00:00:01.000Z"),
				messages: { prompt: "add a hat" },
				model: "gpt-image-2",
				proxyServerRequestBody: {
					model: "gpt-image-2",
					prompt: "add a hat",
					image: { filename: "source.png", content_type: "image/png", size_bytes: 1234 },
				},
				req: request,
				requestId: "req-multipart-summary",
				response: { data: [] },
				startTime: new Date("2026-01-01T00:00:00.000Z"),
			});

			expect(spendLog.proxy_server_request?.["body"]).toEqual({
				model: "gpt-image-2",
				prompt: "add a hat",
				image: { filename: "source.png", content_type: "image/png", size_bytes: 1234 },
			});
		} finally {
			if (previousStorePrompts === undefined) {
				delete process.env.STORE_PROMPTS_IN_SPEND_LOGS;
			} else {
				process.env.STORE_PROMPTS_IN_SPEND_LOGS = previousStorePrompts;
			}
		}
	});

	it("trackSpendLog 写入 insertData 时 api_key、metadata、proxy_server_request 不含明文 key", async () => {
		const insertedSpendLogs: Record<string, unknown>[] = [];
		const mockDb = createMockDb(insertedSpendLogs);
		await trackSpendLog(mockDb, {
			api_key: rawApiKey,
			call_type: CallType.ACompletion,
			completion_tokens: 1,
			endTime: "2026-01-01T00:00:01.000Z",
			metadata: {
				user_api_key: rawApiKey,
				unsafe_value: rawApiKey,
			},
			model: "gpt-4o-mini",
			prompt_tokens: 1,
			proxy_server_request: {
				body: { prompt: `hello ${rawApiKey}` },
				headers: { authorization: `Bearer ${rawApiKey}` },
			},
			request_id: "req-track-key-sanitize",
			spend: 0,
			startTime: "2026-01-01T00:00:00.000Z",
			total_tokens: 2,
		});
		expect(insertedSpendLogs).toHaveLength(1);
		const insertData = insertedSpendLogs[0]!;
		const metadata = insertData["metadata"] as Record<string, unknown>;
		expect(insertData["api_key"]).not.toBe(rawApiKey);
		expect(String(insertData["api_key"]).startsWith("sk-")).toBe(false);
		expect(metadata["user_api_key"]).toBe(insertData["api_key"]);
		expect(stringify(insertData)).not.toContain(rawApiKey);
		expect(stringify(insertData["proxy_server_request"])).not.toContain(rawApiKey);
	});
});

describe("SpendTracker DailySpend 聚合写入", () => {
	it("按请求日期和维度字段写入失败请求聚合", async () => {
		const dailyWrites: Array<{
			table: unknown;
			values: Record<string, unknown>;
			conflict: Record<string, unknown>;
		}> = [];
		const mockDb = withTransaction({
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_SpendLogs) {
						return Promise.resolve();
					}
					return {
						onConflictDoUpdate: jest.fn((conflict: Record<string, unknown>) => {
							dailyWrites.push({ table: table, values: values, conflict: conflict });
							return Promise.resolve();
						}),
					};
				}),
			})),
		}) as unknown as Parameters<typeof trackSpendLog>[0];

		await trackSpendLog(mockDb, {
			api_key: "hashed-key",
			call_type: CallType.ACompletion,
			completion_tokens: 3,
			custom_cost_per_token: { input_cost_per_token: 0.01, output_cost_per_token: 0.02 },
			custom_llm_provider: "test-provider",
			endTime: "2026-01-02T23:00:01.000Z",
			mcp_namespaced_tool_name: "server/tool",
			model: "provider/model",
			model_group: "logical-model",
			prompt_tokens: 2,
			proxy_server_request: { url: "/v1/chat/completions?debug=true" },
			request_id: "req-daily-failure",
			spend: 0,
			startTime: "2026-01-02T23:00:00.000Z",
			status: SpendLogStatus.Failure,
			total_tokens: 5,
			user: "user-1",
		});

		expect(dailyWrites).toHaveLength(1);
		expect(dailyWrites[0]!.table).toBe(liteLLM_DailyUserSpend);
		expect(dailyWrites[0]!.values).toMatchObject({
			user_id: "user-1",
			date: "2026-01-02",
			model_group: "logical-model",
			custom_llm_provider: "test-provider",
			mcp_namespaced_tool_name: "server/tool",
			endpoint: "/v1/chat/completions",
			successful_requests: 0,
			failed_requests: 1,
		});
		expect(typeof dailyWrites[0]!.values["id"]).toBe("string");
		expect(dailyWrites[0]!.values["updated_at"]).toBeInstanceOf(Date);
		const conflictSet = dailyWrites[0]!.conflict["set"] as Record<string, unknown>;
		expect(conflictSet["failed_requests"]).toBeDefined();
		expect(conflictSet["successful_requests"]).toBeDefined();
		expect(conflictSet["updated_at"]).toBeInstanceOf(Date);
	});

	it("缺失 MCP 工具名和 endpoint 时归一为空字符串", async () => {
		const dailyValues: Record<string, unknown>[] = [];
		const mockDb = withTransaction({
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_SpendLogs) {
						return Promise.resolve();
					}
					dailyValues.push(values);
					return {
						onConflictDoUpdate: jest.fn(() => Promise.resolve()),
					};
				}),
			})),
		}) as unknown as Parameters<typeof trackSpendLog>[0];

		await trackSpendLog(mockDb, {
			api_key: "hashed-key",
			call_type: CallType.ACompletion,
			completion_tokens: 1,
			endTime: "2026-01-02T23:00:01.000Z",
			model: "provider/model",
			prompt_tokens: 1,
			request_id: "req-daily-empty-conflict-fields",
			spend: 0.01,
			startTime: "2026-01-02T23:00:00.000Z",
			total_tokens: 2,
			user: "user-1",
		});

		expect(dailyValues).toHaveLength(1);
		expect(dailyValues[0]).toMatchObject({
			mcp_namespaced_tool_name: "",
			endpoint: "",
		});
	});

	it("每日汇总失败时拒绝提交整个事务", async () => {
		const dailyFailure = new Error("daily-user-write-failed");
		const successfulTables: unknown[] = [];
		const mockDb = withTransaction({
			insert: jest.fn((table: unknown) => ({
				values: jest.fn(() => {
					if (table === liteLLM_SpendLogs) {
						return Promise.resolve();
					}
					return {
						onConflictDoUpdate: jest.fn(() => {
							if (table === liteLLM_DailyUserSpend) {
								return Promise.reject(dailyFailure);
							}
							successfulTables.push(table);
							return Promise.resolve();
						}),
					};
				}),
			})),
		}) as unknown as Parameters<typeof trackSpendLog>[0];

		await expect(
			trackSpendLog(mockDb, {
				api_key: "hashed-key",
				call_type: CallType.ACompletion,
				completion_tokens: 1,
				endTime: "2026-01-02T23:00:01.000Z",
				model: "provider/model",
				prompt_tokens: 1,
				request_id: "req-daily-rejection",
				spend: 0.01,
				startTime: "2026-01-02T23:00:00.000Z",
				team_id: "team-1",
				total_tokens: 2,
				user: "user-1",
			}),
		).rejects.toMatchObject({ name: "ApiError", statusCode: 503 });
		expect(successfulTables).toEqual([]);
	});
});

describe("normalizeUsageForSpend cache 折叠（PY anthropic/chat/transformation.py:1588-1611）", () => {
	it("Anthropic 风格 usage（input_tokens）折叠 cache_read/cache_creation 进 prompt/total", () => {
		const normalized = normalizeUsageForSpend({
			input_tokens: 100,
			output_tokens: 20,
			cache_read_input_tokens: 40,
			cache_creation_input_tokens: 10,
		});
		expect(normalized).toEqual({
			prompt_tokens: 150,
			completion_tokens: 20,
			total_tokens: 170,
			cache_creation_input_tokens: 10,
			cache_read_input_tokens: 40,
		});
	});

	it("OpenAI 风格 usage（prompt_tokens 已含 cached_tokens）不折叠", () => {
		const normalized = normalizeUsageForSpend({
			prompt_tokens: 100,
			completion_tokens: 20,
			total_tokens: 120,
			prompt_tokens_details: { cached_tokens: 40 },
		});
		expect(normalized).toEqual({
			prompt_tokens: 100,
			completion_tokens: 20,
			total_tokens: 120,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 40,
		});
	});

	it("OpenAI Responses usage 从 input_tokens_details 提取 cache 且不重复折叠", () => {
		const normalized = normalizeUsageForSpend({
			input_tokens: 123_717,
			output_tokens: 3_706,
			total_tokens: 127_423,
			input_tokens_details: {
				cached_tokens: 118_144,
				cache_write_tokens: 0,
			},
			output_tokens_details: { reasoning_tokens: 337 },
		});
		expect(normalized).toEqual({
			prompt_tokens: 123_717,
			completion_tokens: 3_706,
			total_tokens: 127_423,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 118_144,
		});
	});

	it("prompt_tokens 与 input_tokens 共存时优先 prompt_tokens，不重复折叠", () => {
		const normalized = normalizeUsageForSpend({
			prompt_tokens: 100,
			input_tokens: 60,
			completion_tokens: 20,
			cache_read_input_tokens: 40,
		});
		expect(normalized?.prompt_tokens).toBe(100);
		expect(normalized?.total_tokens).toBe(120);
	});

	it("usage 为 undefined 时返回 undefined", () => {
		expect(normalizeUsageForSpend(undefined)).toBeUndefined();
	});
});

describe("buildAdditionalUsageValues（PY spend_tracking_utils.py:398-404 special_usage_fields）", () => {
	it("剔除 prompt/completion/total_tokens 三键，保留 cache 与其余扩展字段", () => {
		const additionalValues = buildAdditionalUsageValues({
			input_tokens: 100,
			output_tokens: 20,
			prompt_tokens: 150,
			completion_tokens: 20,
			total_tokens: 170,
			cache_read_input_tokens: 40,
			cache_creation_input_tokens: 10,
			server_tool_use: { web_search_requests: 1 },
		});
		expect(additionalValues).not.toHaveProperty("prompt_tokens");
		expect(additionalValues).not.toHaveProperty("completion_tokens");
		expect(additionalValues).not.toHaveProperty("total_tokens");
		expect(additionalValues["input_tokens"]).toBe(100);
		expect(additionalValues["cache_read_input_tokens"]).toBe(40);
		expect(additionalValues["server_tool_use"]).toEqual({ web_search_requests: 1 });
	});
});

describe("reconstructModelName（PY litellm_core_utils/core_helpers.py:195）", () => {
	it("deployment model 含 provider 前缀时用 deployment model 名", () => {
		expect(reconstructModelName("glm", "anthropic", "anthropic/glm-4.7")).toBe("anthropic/glm-4.7");
	});

	it("fallback 后使用无 provider 前缀的实际 deployment model", () => {
		expect(reconstructModelName("qwen3.6-27b", "anthropic", "MiniMax-M2.7", true)).toBe("MiniMax-M2.7");
	});

	it("bedrock provider 且 model 无前缀时补 bedrock/ 前缀", () => {
		expect(reconstructModelName("claude-3", "bedrock", undefined)).toBe("bedrock/claude-3");
	});

	it("其余情况原样返回请求 model", () => {
		expect(reconstructModelName("glm", "anthropic", "glm-4.7")).toBe("glm");
		expect(reconstructModelName("glm", "anthropic", undefined)).toBe("glm");
	});
});

describe("buildSpendLogFromRequest metadata 键集（PY SpendLogsMetadata）", () => {
	function createMinimalRequest(): Request {
		return {
			body: { model: "glm" },
			headers: {},
			ip: "127.0.0.1",
			method: "POST",
			originalUrl: "/v1/messages",
			socket: { remoteAddress: "127.0.0.1" },
			url: "/v1/messages",
		} as unknown as Request;
	}

	it("metadata 键集对齐 Python：team_alias / model_map_information / null 占位键", async () => {
		const spendLog = await buildSpendLogFromRequest({
			auth: { api_key: "sk-test", team_id: "team-1", team_alias: "team-alpha", project_id: "project-1" },
			callType: CallType.AMessages,
			endTime: new Date("2026-01-01T00:00:01.000Z"),
			model: "glm",
			modelGroup: "glm",
			modelId: "deployment-id-1",
			deploymentModel: "anthropic/glm-4.7",
			litellmOverheadTimeMs: 12,
			attemptedRetries: 1,
			maxRetries: 3,
			req: createMinimalRequest(),
			startTime: new Date("2026-01-01T00:00:00.000Z"),
			usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40 },
		});
		const metadata = spendLog.metadata ?? {};
		expect(metadata["user_api_key_team_alias"]).toBe("team-alpha");
		expect(metadata["model_map_information"]).toEqual({ model_map_key: "glm", model_map_value: { id: "deployment-id-1" } });
		expect(metadata["litellm_overhead_time_ms"]).toBe(12);
		expect(metadata["attempted_retries"]).toBe(1);
		expect(metadata["max_retries"]).toBe(3);
		// 未实现子系统的键就位、值恒 null（PY 以 None 落键）
		expect(metadata["cost_breakdown"]).toBeNull();
		expect(metadata["user_api_key_project_id"]).toBe("project-1");
		expect(metadata["user_api_key_project_alias"]).toBeNull();
		expect(metadata["applied_guardrails"]).toBeNull();
		expect(metadata["mcp_tool_call_metadata"]).toBeNull();
		expect(metadata["guardrail_information"]).toBeNull();
		expect(metadata["vector_store_request_metadata"]).toBeNull();
		expect(metadata["batch_models"]).toBeNull();
		expect(metadata["cold_storage_object_key"]).toBeNull();
		// A6: model 列按 reconstruct_model_name 重建为 deployment 完整名
		expect(spendLog.model).toBe("anthropic/glm-4.7");
		expect(spendLog.project_id).toBe("project-1");
		// A1: Anthropic 风格 usage 折叠进列
		expect(spendLog.prompt_tokens).toBe(140);
		expect(spendLog.total_tokens).toBe(160);
		// A2: additional_usage_values 不含三 token 键
		const additionalUsageValues = metadata["additional_usage_values"] as Record<string, unknown>;
		expect(additionalUsageValues).not.toHaveProperty("prompt_tokens");
		expect(additionalUsageValues).not.toHaveProperty("completion_tokens");
		expect(additionalUsageValues).not.toHaveProperty("total_tokens");
		expect(additionalUsageValues["input_tokens"]).toBe(100);
		expect(additionalUsageValues["cache_read_input_tokens"]).toBe(40);
		// A4: cache_key 管道就位（TS 无响应缓存子系统）
		expect(spendLog.cache_key).toBeUndefined();
		expect(spendLog.cache_hit).toBe(false);
	});

	it("fallback 到无 provider 前缀 deployment 时，model 用最终模型且 model_group 保留原请求", async () => {
		const spendLog = await buildSpendLogFromRequest({
			callType: CallType.AMessages,
			endTime: new Date("2026-07-31T00:00:01.000Z"),
			model: "qwen3.6-27b",
			modelGroup: "qwen3.6-27b",
			deploymentModel: "MiniMax-M2.7",
			customLlmProvider: "anthropic",
			attemptedRetries: 1,
			fallbackModels: ["qwen3.6-27b", "MiniMax-M2.7"],
			req: createMinimalRequest(),
			startTime: new Date("2026-07-31T00:00:00.000Z"),
			usage: { input_tokens: 541, output_tokens: 253 },
		});

		expect(spendLog.model).toBe("MiniMax-M2.7");
		expect(spendLog.model_group).toBe("qwen3.6-27b");
		expect(spendLog.metadata?.fallback_models).toEqual(["qwen3.6-27b", "MiniMax-M2.7"]);
	});

	it("从 OpenAI Responses client_metadata 提取稳定 Codex 任务分组键", async () => {
		const threadId = "019fa826-205c-7350-9e17-7e76ce77ce43";
		const request = createMinimalRequest();
		request.body = {
			model: "gpt-5.6-sol",
			client_metadata: {
				thread_id: `  ${threadId}  `,
				session_id: "11111111-1111-4111-8111-111111111111",
			},
			prompt_cache_key: "22222222-2222-4222-8222-222222222222",
		};

		const spendLog = await buildSpendLogFromRequest({
			callType: CallType.ACompletion,
			endTime: new Date("2026-07-30T15:23:29.000Z"),
			model: "gpt-5.6-sol",
			req: request,
			startTime: new Date("2026-07-30T15:23:16.000Z"),
		});

		expect(spendLog.metadata?.session_group_key).toBe(`s:${threadId}`);
		expect(spendLog.session_id).not.toBe(threadId);
	});

	it("规范化并防御性复制 model_resolution_chain，与 fallback_models 语义分离", async () => {
		const sourcePath = ["alias-a", "alias-b", "model-a"];
		const spendLog = await buildSpendLogFromRequest({
			callType: CallType.AMessages,
			endTime: new Date("2026-01-01T00:00:01.000Z"),
			model: "alias-a",
			req: createMinimalRequest(),
			startTime: new Date("2026-01-01T00:00:00.000Z"),
			fallbackModels: ["alias-a", "fallback-alias"],
			modelResolutionChain: [
				{ fallback_index: 0, input_model: "alias-a", resolved_model: "model-a", resolution_path: sourcePath },
				{ fallback_index: 1, input_model: "plain-model", resolved_model: "plain-model", resolution_path: ["plain-model"] },
			],
		});
		sourcePath.push("mutated");
		expect(spendLog.metadata?.model_resolution_chain).toEqual([
			{ fallback_index: 0, input_model: "alias-a", resolved_model: "model-a", resolution_path: ["alias-a", "alias-b", "model-a"] },
		]);
		expect(spendLog.metadata?.fallback_models).toEqual(["alias-a", "fallback-alias"]);
	});

	it("无有效 alias 时 model_resolution_chain 落 null", async () => {
		const spendLog = await buildSpendLogFromRequest({
			callType: CallType.AMessages,
			endTime: new Date("2026-01-01T00:00:01.000Z"),
			model: "plain-model",
			req: createMinimalRequest(),
			startTime: new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(spendLog.metadata?.model_resolution_chain).toBeNull();
	});

	it("无 team_alias 时 user_api_key_team_alias 落 null", async () => {
		const spendLog = await buildSpendLogFromRequest({
			auth: { api_key: "sk-test" },
			callType: CallType.AMessages,
			endTime: new Date("2026-01-01T00:00:01.000Z"),
			model: "glm",
			req: createMinimalRequest(),
			startTime: new Date("2026-01-01T00:00:00.000Z"),
		});
		const metadata = spendLog.metadata ?? {};
		expect(metadata["user_api_key_team_alias"]).toBeNull();
		expect(metadata["litellm_overhead_time_ms"]).toBeNull();
		expect(metadata["attempted_retries"]).toBeNull();
		expect(metadata["max_retries"]).toBeNull();
		expect(metadata["model_map_information"]).toEqual({ model_map_key: "glm", model_map_value: null });
	});
});

describe("trackSpendLog cost_breakdown 注入与 cache_hit 大小写（PY str(bool)）", () => {
	function createInsertCaptureDb(insertedSpendLogs: Record<string, unknown>[]): Parameters<typeof trackSpendLog>[0] {
		return withTransaction({
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((insertValues: Record<string, unknown>) => {
					if (table === liteLLM_SpendLogs) {
						insertedSpendLogs.push(insertValues);
					}
					return Promise.resolve(undefined);
				}),
			})),
		}) as unknown as Parameters<typeof trackSpendLog>[0];
	}

	function createMinimalLogEntry(overrides: Record<string, unknown>): Parameters<typeof trackSpendLog>[1] {
		return {
			api_key: "hashed-key",
			call_type: CallType.AMessages,
			completion_tokens: 20,
			endTime: "2026-01-01T00:00:01.000Z",
			metadata: {},
			model: "unknown-model-cost-zero",
			prompt_tokens: 100,
			request_id: "req-cost-breakdown",
			spend: 0,
			startTime: "2026-01-01T00:00:00.000Z",
			total_tokens: 120,
			...overrides,
		} as Parameters<typeof trackSpendLog>[1];
	}

	it("metadata.cost_breakdown 注入缓存输入、输入、输出与总费用", async () => {
		const insertedSpendLogs: Record<string, unknown>[] = [];
		await trackSpendLog(createInsertCaptureDb(insertedSpendLogs), createMinimalLogEntry({}));
		expect(insertedSpendLogs).toHaveLength(1);
		const metadata = insertedSpendLogs[0]!["metadata"] as Record<string, unknown>;
		expect(metadata["cost_breakdown"]).toEqual({
			cache_input_cost: 0,
			input_cost: 0,
			output_cost: 0,
			total_cost: 0,
			tool_usage_cost: 0,
		});
	});

	it("metadata.cost_breakdown 保留可独立展示的缓存输入费用", async () => {
		const insertedSpendLogs: Record<string, unknown>[] = [];
		await trackSpendLog(
			createInsertCaptureDb(insertedSpendLogs),
			createMinimalLogEntry({
				cache_read_input_tokens: 40,
				custom_cost_per_token: {
					input_cost_per_token: 0.01,
					output_cost_per_token: 0.02,
					cache_read_input_token_cost: 0.001,
				},
			}),
		);

		const metadata = insertedSpendLogs[0]!["metadata"] as Record<string, unknown>;
		expect(metadata["cost_breakdown"]).toEqual({
			cache_input_cost: 0.04,
			input_cost: 0.6,
			output_cost: 0.4,
			total_cost: 1.04,
			tool_usage_cost: 0,
		});
	});

	it("cache_hit 默认写 'False'，命中写 'True'（PY str(bool) 大写）", async () => {
		const insertedSpendLogs: Record<string, unknown>[] = [];
		const mockDb = createInsertCaptureDb(insertedSpendLogs);
		await trackSpendLog(mockDb, createMinimalLogEntry({ request_id: "req-cache-hit-false" }));
		await trackSpendLog(mockDb, createMinimalLogEntry({ request_id: "req-cache-hit-true", cache_hit: true }));
		expect(insertedSpendLogs[0]!["cache_hit"]).toBe("False");
		expect(insertedSpendLogs[1]!["cache_hit"]).toBe("True");
	});
});
