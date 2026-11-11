/**
 * Speed 页面数据源（/global/model_speed）契约测试
 *
 * 守住五件会直接影响页面的约定：
 * 1. 时间桶内的 TPS 是「可测算请求的算术平均」，聚合值按请求数加权，不是求和；
 * 2. 单个时段样本少于 3 个请求时按「没有数据」处理——不画点，也不计入模型级平均；
 * 3. 有调用但没有可用数据点的模型（图片生成、检索工具、样本始终不足）必须单独列出，
 *    不能从页面上悄悄消失；
 * 4. 同一模型由不同供应商执行时按「模型 × 供应商」分成独立序列，速度不能混算；
 *    cliproxy 历史行按模型前缀归一成真实供应商，避免同名卡片重复；
 * 5. 非法时区 / 区间 / 粒度返回 400，internal_user 只能看到自己的调用。
 */

import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../core/api/ApiError";
import type { UserAPIKeyAuth } from "../types/auth";
import {
	addDays,
	buildModelSpeedReport,
	currentDayInTimeZone,
	MIN_BUCKET_REQUESTS,
	parseSpeedDateRange,
	parseSpeedTimeZone,
	registerModelSpeedEndpoints,
	resolveSpeedBucket,
	speedProviderIdentity,
	type SpeedAggregateRow,
} from "./ModelSpeedEndpoint";

const OPTIONS = {
	startDate: "2026-10-27",
	endDate: "2026-11-02",
	bucket: "hour" as const,
	timezone: "Asia/Shanghai",
	buckets: ["2026-11-02T00:00:00.000Z", "2026-11-02T01:00:00.000Z"],
};

/** 把 Drizzle SQL 片段里的列名、字符串与绑定值摊平成可断言文本 */
function describeSql(value: unknown): string {
	const out: string[] = [];
	const visited = new WeakSet<object>();
	const walk = (node: unknown): void => {
		if (node === null || node === undefined) {
			return;
		}
		if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
			out.push(String(node));
			return;
		}
		if (typeof node !== "object" || visited.has(node as object)) {
			return;
		}
		visited.add(node as object);
		const record = node as Record<string, unknown>;
		if (Array.isArray(record.queryChunks)) {
			walk(record.queryChunks);
		}
		if (typeof record.name === "string") {
			out.push("col:" + record.name);
		}
		for (const [key, child] of Object.entries(record)) {
			if (key === "decoder" || key === "table" || key === "config") {
				continue;
			}
			walk(child);
		}
	};
	walk(value);
	return out.join(" ");
}

interface FakeDbHandle {
	readonly db: unknown;
	/** 已捕获的 SQL 文本，包含两条来源与时间轴查询 */
	readonly sqlText: () => string;
}

/** 最小 Drizzle 替身：只保留本端点用到的 execute 入口 */
function createFakeDb(rows: readonly SpeedAggregateRow[], axis: readonly { bucket_start: string }[]): FakeDbHandle {
	const statements: string[] = [];
	return {
		db: {
			execute: (query: unknown) => {
				const text = describeSql(query);
				statements.push(text);
				return Promise.resolve({ rows: text.includes("generate_series") ? axis : rows });
			},
		},
		sqlText: () => statements.join("\n"),
	};
}

function createApp(
	auth: UserAPIKeyAuth,
	rows: readonly SpeedAggregateRow[] = [],
	axis: readonly { bucket_start: string }[] = [],
): { app: express.Express; handle: FakeDbHandle } {
	const handle = createFakeDb(rows, axis);
	const app = express();
	app.use((req: Request, _res: Response, next: NextFunction) => {
		req.auth = auth;
		next();
	});
	const router = express.Router();
	registerModelSpeedEndpoints(router, handle.db as never);
	app.use(router);
	app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		if (error instanceof ApiError) {
			res.status(error.statusCode).json({ error: { message: error.message } });
			return;
		}
		res.status(500).json({ error: { message: "unexpected" } });
	});
	return { app, handle };
}

const ADMIN_AUTH: UserAPIKeyAuth = { user_id: "admin-user", user_role: "proxy_admin" } as UserAPIKeyAuth;

describe("buildModelSpeedReport", () => {
	it("按模型聚合时间序列并按平均输出 TPS 降序排列", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-02T01:00:00.000Z", model: "fast", provider: "minimax", calls: 10, requests: 8, avg_tps: 100, p50_tps: 90 },
			{ bucket: "2026-11-02T00:00:00.000Z", model: "fast", provider: "minimax", calls: 10, requests: 4, avg_tps: 50, p50_tps: 40 },
			{ bucket: "2026-11-02T00:00:00.000Z", model: "slow", provider: "minimax", calls: 3, requests: 3, avg_tps: 10, p50_tps: 9 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models.map((entry) => entry.model)).toEqual(["fast", "slow"]);
		// 时间点按时间升序，便于前端直接连线
		expect(report.models[0]!.points.map((point) => point.bucket)).toEqual(["2026-11-02T00:00:00.000Z", "2026-11-02T01:00:00.000Z"]);
		// 均值按请求数加权：(50*4 + 100*8) / 12
		expect(report.models[0]!.avg_tps).toBeCloseTo(83.333, 3);
		expect(report.models[0]!.requests).toBe(12);
		expect(report.models[0]!.calls).toBe(20);
	});

	it("同一模型由不同供应商执行时分成两条序列，速度不混算", () => {
		const rows: SpeedAggregateRow[] = [
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "claude-opus-4-5",
				provider: "opencode-go",
				calls: 8,
				requests: 8,
				avg_tps: 95,
				p50_tps: 90,
			},
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "claude-opus-4-5",
				provider: "claude-subscription",
				calls: 4,
				requests: 4,
				avg_tps: 40,
				p50_tps: 38,
			},
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models.map((entry) => [entry.model, entry.provider, entry.avg_tps])).toEqual([
			["claude-opus-4-5", "opencode-go", 95],
			["claude-opus-4-5", "claude-subscription", 40],
		]);
	});

	it("供应商为空的历史行仍可归组，provider 输出为空字符串", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-02T00:00:00.000Z", model: "legacy-model", provider: null, calls: 3, requests: 3, avg_tps: 42, p50_tps: 41 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models[0]!.provider).toBe("");
		expect(report.models[0]!.avg_tps).toBeCloseTo(42, 6);
	});

	it("历史 cliproxy 行按模型前缀归一供应商，与真实 provider 合并成一条序列", () => {
		const rows: SpeedAggregateRow[] = [
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "cliproxy/commandcode/deepseek/deepseek-v4.1-flash",
				provider: "cliproxy",
				calls: 30,
				requests: 30,
				avg_tps: 70,
				p50_tps: 68,
			},
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "cliproxy/commandcode/deepseek/deepseek-v4.1-flash",
				provider: "commandcode",
				calls: 20,
				requests: 20,
				avg_tps: 90,
				p50_tps: 88,
			},
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		// 两行实际都由 CommandCode 执行：只应出现一张卡片，速度按请求数加权
		expect(report.models).toHaveLength(1);
		const entry = report.models[0]!;
		expect(entry.provider).toBe("commandcode");
		expect(entry.calls).toBe(50);
		expect(entry.requests).toBe(50);
		expect(entry.avg_tps).toBeCloseTo((70 * 30 + 90 * 20) / 50, 6);
	});

	it("cliproxy 前缀不是订阅供应商时归一为空供应商，仍可与空 provider 行合并", () => {
		const rows: SpeedAggregateRow[] = [
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "cliproxy/gpt-5.6-luna",
				provider: "cliproxy",
				calls: 5,
				requests: 5,
				avg_tps: 33,
				p50_tps: 32,
			},
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "cliproxy/gpt-5.6-luna",
				provider: "",
				calls: 3,
				requests: 3,
				avg_tps: 45,
				p50_tps: 44,
			},
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models).toHaveLength(1);
		expect(report.models[0]!.provider).toBe("");
		expect(report.models[0]!.calls).toBe(8);
	});

	it("排序看平均 TPS 而不是调用量：忙而慢的模型排在闲而快之后", () => {
		const rows: SpeedAggregateRow[] = [
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "busy-slow",
				provider: "minimax",
				calls: 1000,
				requests: 1000,
				avg_tps: 18,
				p50_tps: 18,
			},
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "quiet-fast",
				provider: "minimax",
				calls: 5,
				requests: 5,
				avg_tps: 180,
				p50_tps: 175,
			},
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models.map((entry) => entry.model)).toEqual(["quiet-fast", "busy-slow"]);
	});

	it("平均 TPS 相同时按样本量、再按名字稳定排序", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-02T00:00:00.000Z", model: "b-model", provider: "minimax", calls: 4, requests: 4, avg_tps: 60, p50_tps: 60 },
			{ bucket: "2026-11-02T00:00:00.000Z", model: "a-model", provider: "minimax", calls: 4, requests: 4, avg_tps: 60, p50_tps: 60 },
			{ bucket: "2026-11-02T00:00:00.000Z", model: "heavy", provider: "minimax", calls: 40, requests: 40, avg_tps: 60, p50_tps: 60 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models.map((entry) => entry.model)).toEqual(["heavy", "a-model", "b-model"]);
	});

	it("单个时段不足 2 个请求时不画点，也不计入模型级平均", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-02T00:00:00.000Z", model: "steady", provider: "minimax", calls: 12, requests: 12, avg_tps: 90, p50_tps: 85 },
			{ bucket: "2026-11-02T01:00:00.000Z", model: "steady", provider: "minimax", calls: 1, requests: 1, avg_tps: 400, p50_tps: 400 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);
		const entry = report.models[0]!;

		// 单样本时段被当成「没有数据」：不出现，也不把 400 拉进平均
		expect(MIN_BUCKET_REQUESTS).toBe(2);
		expect(entry.points.map((point) => point.bucket)).toEqual(["2026-11-02T00:00:00.000Z"]);
		expect(entry.avg_tps).toBeCloseTo(90, 6);
		expect(entry.requests).toBe(12);
		// 调用量仍然完整计数
		expect(entry.calls).toBe(13);
	});

	it("两个请求的时段已经算有效数据点", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-02T00:00:00.000Z", model: "thin", provider: "minimax", calls: 2, requests: 2, avg_tps: 120, p50_tps: 120 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models).toHaveLength(1);
		expect(report.models[0]!.points).toHaveLength(1);
		expect(report.models[0]!.avg_tps).toBeCloseTo(120, 6);
	});

	it("所有时段都样本不足时归入 without_speed，而不是画成空曲线", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-02T00:00:00.000Z", model: "rare", provider: "minimax", calls: 1, requests: 1, avg_tps: 120, p50_tps: 120 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models).toHaveLength(0);
		expect(report.models_without_speed).toEqual([{ model: "rare", provider: "minimax", calls: 1 }]);
	});

	it("把没有可测算输出的模型单独列出，而不是丢弃或画成 0 TPS", () => {
		const rows: SpeedAggregateRow[] = [
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "text-model",
				provider: "minimax",
				calls: 5,
				requests: 4,
				avg_tps: 80,
				p50_tps: 75,
			},
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "image-model",
				provider: "minimax",
				calls: 12,
				requests: 0,
				avg_tps: null,
				p50_tps: null,
			},
			{
				bucket: "2026-11-02T00:00:00.000Z",
				model: "search-tool",
				provider: "minimax",
				calls: 7,
				requests: 0,
				avg_tps: null,
				p50_tps: null,
			},
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models.map((entry) => entry.model)).toEqual(["text-model"]);
		expect(report.models_without_speed).toEqual([
			{ model: "image-model", provider: "minimax", calls: 12 },
			{ model: "search-tool", provider: "minimax", calls: 7 },
		]);
	});

	it("接受 PostgreSQL 的 timestamptz 文本（只带小时偏移），不把数据点丢成空序列", () => {
		// 驱动层对裸 SQL 投影可能返回文本而非 Date；生产环境观测到的形式是 "+00"
		const rows: SpeedAggregateRow[] = [
			{
				bucket: "2026-11-01 06:00:00+00",
				model: "MiniMax-M3",
				provider: "minimax",
				calls: 31,
				requests: 27,
				avg_tps: 94.6,
				p50_tps: 79.1,
			},
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models_without_speed).toHaveLength(0);
		expect(report.models[0]!.points).toEqual([{ bucket: "2026-11-01T06:00:00.000Z", avg_tps: 94.6, p50_tps: 79.1, requests: 27 }]);
	});

	it("同时接受 ISO 与带分钟偏移的时间文本", () => {
		const rows: SpeedAggregateRow[] = [
			{ bucket: "2026-11-01T01:00:00.000Z", model: "a", provider: "minimax", calls: 3, requests: 3, avg_tps: 11, p50_tps: 11 },
			{ bucket: "2026-11-01 10:00:00+08:00", model: "a", provider: "minimax", calls: 3, requests: 3, avg_tps: 12, p50_tps: 12 },
			{ bucket: "2026-11-01 03:00:00.123", model: "a", provider: "minimax", calls: 3, requests: 3, avg_tps: 13, p50_tps: 13 },
		];

		const report = buildModelSpeedReport(rows, OPTIONS);

		expect(report.models[0]!.points.map((point) => point.bucket)).toEqual([
			"2026-11-01T01:00:00.000Z",
			"2026-11-01T02:00:00.000Z",
			"2026-11-01T03:00:00.123Z",
		]);
	});

	it("回传口径信息与完整时间轴，页面据此在缺口处断线", () => {
		const report = buildModelSpeedReport([], OPTIONS);

		expect(report).toMatchObject({
			start_date: "2026-10-27",
			end_date: "2026-11-02",
			bucket: "hour",
			timezone: "Asia/Shanghai",
			min_output_tokens: 20,
			min_bucket_requests: 2,
			buckets: OPTIONS.buckets,
		});
	});
});

describe("speedProviderIdentity", () => {
	it("把 cliproxy 行归一成模型前缀里的订阅供应商", () => {
		expect(speedProviderIdentity("cliproxy/opencode-go/deepseek-v4", "cliproxy")).toBe("opencode-go");
		expect(speedProviderIdentity("CLIProxy/CommandCode/x", "CLIProxy")).toBe("commandcode");
		expect(speedProviderIdentity("opencode-go/deepseek-v4", "cliproxy")).toBe("opencode-go");
	});

	it("前缀不是订阅供应商时归一为空，与 Dashboard 的 modelSupplier 一致", () => {
		expect(speedProviderIdentity("cliproxy/gpt-5.6-luna", "cliproxy")).toBe("");
		expect(speedProviderIdentity("gpt-5.6-luna", "cliproxy")).toBe("");
	});

	it("非 cliproxy 行保留原值，只把空值与 - 归一为空", () => {
		expect(speedProviderIdentity("MiniMax-M3", "minimax")).toBe("minimax");
		expect(speedProviderIdentity("MiniMax-M3", " - ")).toBe("");
		expect(speedProviderIdentity("MiniMax-M3", null)).toBe("");
		expect(speedProviderIdentity("MiniMax-M3", undefined)).toBe("");
	});
});

describe("parseSpeedTimeZone", () => {
	it("未传时区时使用 UTC", () => {
		expect(parseSpeedTimeZone(undefined)).toBe("UTC");
		expect(parseSpeedTimeZone("   ")).toBe("UTC");
	});

	it("接受 IANA 时区名", () => {
		expect(parseSpeedTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
		expect(parseSpeedTimeZone("America/New_York")).toBe("America/New_York");
	});

	it.each(["Mars/Phobos", "Asia Shanghai", "UTC; DROP TABLE", 42])("拒绝非法时区 %s", (value) => {
		expect(() => parseSpeedTimeZone(value)).toThrow(ApiError);
	});
});

describe("parseSpeedDateRange", () => {
	const now = new Date("2026-11-03T04:00:00Z");

	it("默认返回指定时区最近 7 个自然日", () => {
		expect(parseSpeedDateRange({}, "Asia/Shanghai", now)).toEqual({
			startDate: "2026-10-28",
			endDate: "2026-11-03",
			rangeDays: 6,
		});
	});

	it("按调用方时区判断今天，而不是按 UTC", () => {
		const lateUtc = new Date("2026-11-02T20:00:00Z");
		expect(currentDayInTimeZone("Asia/Shanghai", lateUtc)).toBe("2026-11-03");
		expect(currentDayInTimeZone("UTC", lateUtc)).toBe("2026-11-02");
	});

	it("接受显式区间", () => {
		expect(parseSpeedDateRange({ start_date: "2026-10-01", end_date: "2026-10-31" }, "UTC", now)).toEqual({
			startDate: "2026-10-01",
			endDate: "2026-10-31",
			rangeDays: 30,
		});
	});

	it.each([
		[{ start_date: "2026-11-05", end_date: "2026-11-03" }, "start_date must not be after end_date"],
		[{ start_date: "2026-02-30", end_date: "2026-03-05" }, "start_date must be a valid YYYY-MM-DD value"],
		[{ start_date: "2026/10/01", end_date: "2026-10-31" }, "start_date must be a valid YYYY-MM-DD value"],
		[{ start_date: "2025-01-01", end_date: "2026-11-03" }, "Date range must be at most 366 days"],
	])("拒绝非法区间 %#", (query, message) => {
		expect(() => parseSpeedDateRange(query as Record<string, unknown>, "UTC", now)).toThrow(message);
	});
});

describe("resolveSpeedBucket", () => {
	it("7 天以内默认按小时，更长区间默认按天", () => {
		expect(resolveSpeedBucket(6, undefined)).toBe("hour");
		expect(resolveSpeedBucket(7, undefined)).toBe("hour");
		expect(resolveSpeedBucket(29, undefined)).toBe("day");
	});

	it("允许显式指定粒度", () => {
		expect(resolveSpeedBucket(29, "hour")).toBe("hour");
		expect(resolveSpeedBucket(3, "day")).toBe("day");
	});

	it.each(["week", "HOUR", 7])("拒绝非法粒度 %s", (value) => {
		expect(() => resolveSpeedBucket(3, value)).toThrow(ApiError);
	});

	it("超过 31 天时拒绝小时桶", () => {
		expect(() => resolveSpeedBucket(90, "hour")).toThrow("hourly buckets are only available");
	});
});

describe("GET /global/model_speed", () => {
	it("返回按模型分组的时间序列与完整时间轴", async () => {
		const { app } = createApp(
			ADMIN_AUTH,
			[
				{
					bucket: "2026-11-02T01:00:00.000Z",
					model: "MiniMax-M3",
					provider: "minimax",
					calls: 10,
					requests: 8,
					avg_tps: 100,
					p50_tps: 90,
				},
			],
			[{ bucket_start: "2026-11-02T00:00:00.000Z" }, { bucket_start: "2026-11-02T01:00:00.000Z" }],
		);

		const response = await request(app).get("/global/model_speed?start_date=2026-11-01&end_date=2026-11-02&timezone=Asia/Shanghai");

		expect(response.status).toBe(200);
		expect(response.body.models).toHaveLength(1);
		expect(response.body.models[0]).toMatchObject({ model: "MiniMax-M3", provider: "minimax", requests: 8, calls: 10 });
		expect(response.body.models[0].points).toEqual([{ bucket: "2026-11-02T01:00:00.000Z", avg_tps: 100, p50_tps: 90, requests: 8 }]);
		expect(response.body.buckets).toEqual(["2026-11-02T00:00:00.000Z", "2026-11-02T01:00:00.000Z"]);
		expect(response.body.min_bucket_requests).toBe(2);
	});

	it("按最终执行的模型归组：缺 deployment 时用 resolved_model_group，而不是请求名", async () => {
		const { app, handle } = createApp(ADMIN_AUTH);

		await request(app).get("/global/model_speed?start_date=2026-11-01&end_date=2026-11-02");

		const query = handle.sqlText();
		// fallback 行的 model 列会退化成请求名，必须由 resolved_model_group 纠正；
		// 该分支只扫描 model_id 为空的行，其余行走覆盖索引。
		expect(query).toContain("resolved_model_group");
		expect(query).toContain("col:model_id");
		expect(query).toContain("col:model");
		// 供应商是序列身份的一部分，响应必须带上实际执行的 Provider
		expect(query).toContain("col:custom_llm_provider");
	});

	it("internal_user 只查询自己产生的调用", async () => {
		const internalUser: UserAPIKeyAuth = { user_id: "user-42", user_role: "internal_user" } as UserAPIKeyAuth;
		const { app, handle } = createApp(internalUser);

		const response = await request(app).get("/global/model_speed?start_date=2026-11-01&end_date=2026-11-02");

		expect(response.status).toBe(200);
		expect(handle.sqlText()).toContain("user-42");
	});

	it("proxy_admin 不加 user 过滤", async () => {
		const { app, handle } = createApp(ADMIN_AUTH);

		const response = await request(app).get("/global/model_speed?start_date=2026-11-01&end_date=2026-11-02");

		expect(response.status).toBe(200);
		expect(handle.sqlText()).not.toContain("user-42");
	});

	it.each([
		["/global/model_speed?bucket=week", 400],
		["/global/model_speed?timezone=Mars/Phobos", 400],
		["/global/model_speed?start_date=2026-11-05&end_date=2026-11-03", 400],
	])("非法参数返回 400：%s", async (url, status) => {
		const { app } = createApp(ADMIN_AUTH);
		expect((await request(app).get(url)).status).toBe(status);
	});

	it("addDays 跨月边界正确", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(addDays("2026-11-02", 1)).toBe("2026-11-03");
	});
});
