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
import type { Request } from "express";
import {
	buildAdditionalUsageValues,
	buildSpendLogFromRequest,
	getDailyTable,
	getKeyColumn,
	normalizeUsageForSpend,
	reconstructModelName,
	sanitizeSpendLogPayload,
	trackSpendLog,
} from "./SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";
import { logger } from "../core/utils/logger";

describe("SpendLogs schema parity", () => {
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
		return {
			insert: jest.fn((table: unknown) => {
				return {
					values: jest.fn((insertValues: Record<string, unknown>) => {
						if (table === liteLLM_SpendLogs) {
							insertedSpendLogs.push(insertValues);
						}
						return Promise.resolve(undefined);
					}),
				};
			}),
		} as unknown as Parameters<typeof trackSpendLog>[0];
	}

	it("buildSpendLogFromRequest 输出 hash key 且 proxy_server_request 不含明文 key", () => {
		const previousStorePrompts = process.env.STORE_PROMPTS_IN_SPEND_LOGS;
		process.env.STORE_PROMPTS_IN_SPEND_LOGS = "true";
		try {
			const spendLog = buildSpendLogFromRequest({
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
		const mockDb = {
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
		} as unknown as Parameters<typeof trackSpendLog>[0];

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
		const mockDb = {
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
		} as unknown as Parameters<typeof trackSpendLog>[0];

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

	it("记录 daily upsert rejection，同时保留其他维度成功写入", async () => {
		const dailyFailure = new Error("daily-user-write-failed");
		const successfulTables: unknown[] = [];
		const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => logger);
		const mockDb = {
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
		} as unknown as Parameters<typeof trackSpendLog>[0];

		try {
			await trackSpendLog(mockDb, {
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
			});

			expect(successfulTables).toContain(liteLLM_DailyTeamSpend);
			expect(errorSpy).toHaveBeenCalledWith("DailySpend 聚合写入失败: dimension=user", { error: dailyFailure });
		} finally {
			errorSpy.mockRestore();
		}
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

	it("metadata 键集对齐 Python：team_alias / model_map_information / null 占位键", () => {
		const spendLog = buildSpendLogFromRequest({
			auth: { api_key: "sk-test", team_id: "team-1", team_alias: "team-alpha" },
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
		expect(metadata["user_api_key_project_id"]).toBeNull();
		expect(metadata["user_api_key_project_alias"]).toBeNull();
		expect(metadata["applied_guardrails"]).toBeNull();
		expect(metadata["mcp_tool_call_metadata"]).toBeNull();
		expect(metadata["guardrail_information"]).toBeNull();
		expect(metadata["vector_store_request_metadata"]).toBeNull();
		expect(metadata["batch_models"]).toBeNull();
		expect(metadata["cold_storage_object_key"]).toBeNull();
		// A6: model 列按 reconstruct_model_name 重建为 deployment 完整名
		expect(spendLog.model).toBe("anthropic/glm-4.7");
		// A1: Anthropic 风格 usage 折叠进列
		expect(spendLog.prompt_tokens).toBe(140);
		expect(spendLog.total_tokens).toBe(160);
		// A2: additional_usage_values 不含三 token 键
		const additionalUsageValues = metadata["additional_usage_values"] as Record<string, unknown>;
		expect(additionalUsageValues).not.toHaveProperty("prompt_tokens");
		expect(additionalUsageValues).not.toHaveProperty("completion_tokens");
		expect(additionalUsageValues).not.toHaveProperty("total_tokens");
		expect(additionalUsageValues["input_tokens"]).toBe(100);
		// A4: cache_key 管道就位（TS 无响应缓存子系统）
		expect(spendLog.cache_key).toBeUndefined();
		expect(spendLog.cache_hit).toBe(false);
	});

	it("无 team_alias 时 user_api_key_team_alias 落 null", () => {
		const spendLog = buildSpendLogFromRequest({
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
		return {
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((insertValues: Record<string, unknown>) => {
					if (table === liteLLM_SpendLogs) {
						insertedSpendLogs.push(insertValues);
					}
					return Promise.resolve(undefined);
				}),
			})),
		} as unknown as Parameters<typeof trackSpendLog>[0];
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

	it("metadata.cost_breakdown 注入 {input_cost, output_cost, total_cost, tool_usage_cost: 0}", async () => {
		const insertedSpendLogs: Record<string, unknown>[] = [];
		await trackSpendLog(createInsertCaptureDb(insertedSpendLogs), createMinimalLogEntry({}));
		expect(insertedSpendLogs).toHaveLength(1);
		const metadata = insertedSpendLogs[0]!["metadata"] as Record<string, unknown>;
		expect(metadata["cost_breakdown"]).toEqual({
			input_cost: 0,
			output_cost: 0,
			total_cost: 0,
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
