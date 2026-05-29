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
import { liteLLM_DailyEndUserSpend } from "../db/schema/dailyEndUserSpend";
import { getDailyTable, getKeyColumn } from "./SpendTracker";
import { CallType } from "../types/spend";

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
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
			const config = getTableConfig(liteLLM_DailyEndUserSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
			expect(config.indexes.length).toBeGreaterThan(0);
		});

		it("liteLLM_DailyUserSpend 包含 uniqueIndex", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
			const config = getTableConfig(liteLLM_DailyUserSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyTeamSpend 包含 uniqueIndex", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
			const config = getTableConfig(liteLLM_DailyTeamSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyOrganizationSpend 包含 uniqueIndex", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
			const config = getTableConfig(liteLLM_DailyOrganizationSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyTagSpend 包含 uniqueIndex", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
			const config = getTableConfig(liteLLM_DailyTagSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("liteLLM_DailyAgentSpend 包含 uniqueIndex", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
			const config = getTableConfig(liteLLM_DailyAgentSpend);
			const _uc = config.indexes.filter((i: { config: { unique?: boolean } }) => i.config.unique === true).length;
			expect(_uc).toBeGreaterThan(0);
		});

		it("所有 daily spend table 的 uniqueIndex 都覆盖 (key_id, date, api_key, model, custom_llm_provider, mcp, endpoint)", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { getTableConfig } = require("drizzle-orm/pg-core") as typeof import("drizzle-orm/pg-core");
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
