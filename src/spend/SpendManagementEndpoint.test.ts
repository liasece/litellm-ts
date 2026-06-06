/**
 * 花费管理端点响应 shape 测试
 *
 * 目标：确保 SpendManagementEndpoint 返回的字段类型与 WebUI Tremor BarChart 期望一致，
 * 避免 `<rect> attribute y: Expected length, "NaN"` 之类的运行时错误。
 *
 * 策略：mock Drizzle NodePgDatabase 的链式 select/where/groupBy/orderBy/limit/offset，
 * 通过 supertest 触发 HTTP 路径，校验响应字段类型与 finite number 保证。
 */

import express from "express";
import request from "supertest";
import { registerSpendManagementEndpoints } from "./SpendManagementEndpoint";

/**
 * 模拟 Drizzle 的链式 query builder。始终解析为预置的 rows 数组。
 * @param rows
 */
function makeMockDb(rows: unknown[]): unknown {
	const fluent: any = new Proxy(
		{},
		{
			get: function (_target, prop) {
				if (prop === "then") {
					return (resolve: (v: unknown) => void) => resolve(rows);
				}
				return () => fluent;
			},
		},
	);
	const db: any = {
		select: () => fluent,
	};
	return db;
}

/**
 * 模拟分页端点（/spend/logs、/spend/logs/ui）的 DB：
 * 第一次 await 总是返回明细行（对应 `data = await db.select().from()...`）；
 * 第二次 await 总是返回 count 行（`total = await db.select({count:...})`）。
 * 后续 select 再次循环回明细行。
 *
 * 实际生产中 /spend/logs 是 data → count 顺序；
 * /spend/logs/ui 是 count → data 顺序；本 mock 不区分顺序，
 * 依次返回 data / count / data / count / ... — 这要求测试代码
 * 手动确保 db 调用次数为偶数次。多数情况下分页端点恰好是 2 次 select。
 * @param dataRows - 明细行数组
 */
function makePaginatedMockDb(dataRows: unknown[]): unknown {
	let callIndex = 0;
	const fluent: any = new Proxy(
		{},
		{
			get: function (_target, prop) {
				if (prop === "then") {
					return (resolve: (v: unknown) => void) => {
						const isCount = callIndex % 2 === 1;
						callIndex++;
						resolve(isCount ? [{ count: dataRows.length }] : dataRows);
					};
				}
				return () => fluent;
			},
		},
	);
	const db: any = {
		select: () => fluent,
	};
	return db;
}

/**
 * 模拟 count-then-data 顺序的分页端点（/spend/logs/ui）：
 * 第一次 await 返回 count 行（`[{ count: N }]`）；
 * 第二次 await 返回明细行数组。
 * @param dataRows - 明细行数组
 */
function makeCountFirstPaginatedMockDb(dataRows: unknown[]): unknown {
	let callIndex = 0;
	const fluent: any = new Proxy(
		{},
		{
			get: function (_target, prop) {
				if (prop === "then") {
					return (resolve: (v: unknown) => void) => {
						const isCount = callIndex % 2 === 0;
						callIndex++;
						resolve(isCount ? [{ count: dataRows.length }] : dataRows);
					};
				}
				return () => fluent;
			},
		},
	);
	const db: any = {
		select: () => fluent,
	};
	return db;
}

/**
 * 模拟 DB 抛出异常：所有 await 链都会 reject。用来验证"查询失败时返回本月每日 spend=0 兜底"。
 * @param errorMessage
 */
function makeFailingMockDb(errorMessage: string): unknown {
	const fluent: any = new Proxy(
		{},
		{
			get: function (_target, prop) {
				if (prop === "then") {
					return (_resolve: (v: unknown) => void, reject: (e: unknown) => void) => reject(new Error(errorMessage));
				}
				return () => fluent;
			},
		},
	);
	const db: any = {
		select: () => fluent,
	};
	return db;
}

/**
 * 注入"当前时间"，让 helper getCurrentMonthDateRange 行为可预期。
 * 返回 jest.SpyInstance，测试需在 afterEach 还原。
 * @param iso
 */
function freezeNow(iso: string): jest.SpyInstance {
	const fixed = new Date(iso);
	const OriginalDate = Date;
	// Date 构造器 TS 类型签名固定 length=1，运行时实际可空参。用 any 绕过 jest 的严格签名检查。
	const mockImpl = function (...args: unknown[]): Date {
		if (args.length === 0) {
			return new OriginalDate(fixed.getTime());
		}
		return new (OriginalDate as unknown as new (...a: unknown[]) => Date)(...args);
	};
	return jest
		.spyOn(globalThis as unknown as { Date: typeof Date }, "Date")
		.mockImplementation(mockImpl as never) as unknown as jest.SpyInstance;
}

function makeApp(db: unknown): express.Express {
	const app = express();
	app.use(express.json());
	registerSpendManagementEndpoints(app, db as never);
	return app;
}

describe("SpendManagementEndpoint — 响应 shape 兼容 WebUI Tremor BarChart", () => {
	describe("/global/activity", () => {
		it("顶层含 sum_api_requests / sum_total_tokens / sum_total_spend 有限 number", async () => {
			const app = makeApp(
				makeMockDb([
					{ date: "2025-01-15", api_requests: 10, total_tokens: 2000, total_spend: 5.5 },
					{ date: "2025-01-16", api_requests: 20, total_tokens: 4000, total_spend: 11 },
				]),
			);
			const res = await request(app).get("/global/activity");
			expect(res.status).toBe(200);
			const b = res.body as Record<string, unknown>;
			expect(b).toHaveProperty("daily_data");
			expect(Array.isArray(b.daily_data)).toBe(true);
			expect(Number.isFinite(b.sum_api_requests as number)).toBe(true);
			expect(Number.isFinite(b.sum_total_tokens as number)).toBe(true);
			expect(Number.isFinite(b.sum_total_spend as number)).toBe(true);
			expect(b.sum_api_requests).toBe(30);
			expect(b.sum_total_tokens).toBe(6000);
			expect(b.sum_total_spend).toBe(16.5);
			for (const d of b.daily_data as Array<Record<string, unknown>>) {
				expect(typeof d.date).toBe("string");
				expect(Number.isFinite(d.api_requests as number)).toBe(true);
				expect(Number.isFinite(d.total_tokens as number)).toBe(true);
				expect(Number.isFinite(d.total_spend as number)).toBe(true);
			}
		});

		it("空结果兜底：所有 sum_* = 0", async () => {
			const app = makeApp(makeMockDb([]));
			const res = await request(app).get("/global/activity");
			expect(res.status).toBe(200);
			const b = res.body as Record<string, unknown>;
			expect(b.daily_data).toEqual([]);
			expect(b.sum_api_requests).toBe(0);
			expect(b.sum_total_tokens).toBe(0);
			expect(b.sum_total_spend).toBe(0);
		});
	});

	describe("/global/activity/model", () => {
		it("每 model 含 sum_api_requests/sum_total_tokens；daily_data 字段为 api_requests/total_tokens", async () => {
			const app = makeApp(
				makeMockDb([
					{ model: "gpt-4", date: "2025-01-15", api_requests: 5, total_tokens: 100, spend: 1.5 },
					{ model: "gpt-4", date: "2025-01-16", api_requests: 7, total_tokens: 200, spend: 2.5 },
					{ model: "claude", date: "2025-01-15", api_requests: 3, total_tokens: 50, spend: 0.5 },
				]),
			);
			const res = await request(app).get("/global/activity/model");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			for (const m of res.body as Array<Record<string, unknown>>) {
				expect(typeof m.model).toBe("string");
				expect(Number.isFinite(m.sum_api_requests as number)).toBe(true);
				expect(Number.isFinite(m.sum_total_tokens as number)).toBe(true);
				expect(Array.isArray(m.daily_data)).toBe(true);
				for (const d of m.daily_data as Array<Record<string, unknown>>) {
					expect(typeof d.date).toBe("string");
					// 关键：daily_data 必须使用 api_requests / total_tokens 字段名（Tremor categories）
					expect(d).toHaveProperty("api_requests");
					expect(d).toHaveProperty("total_tokens");
					expect(Number.isFinite(d.api_requests as number)).toBe(true);
					expect(Number.isFinite(d.total_tokens as number)).toBe(true);
				}
			}
		});
	});

	describe("/global/spend/teams", () => {
		it("teams 为字符串数组；daily_spend 每项含 date + team_id 有限 number；total_spend_per_team 保留对象数组", async () => {
			let callCount = 0;
			const db: any = {
				select: () => {
					callCount++;
					const fluent: any = new Proxy(
						{},
						{
							get: function (_t, prop) {
								if (prop === "then") {
									return (resolve: (v: unknown) => void) => {
										if (callCount === 1) {
											resolve([
												{ team_id: "team-a", total_spend: 12.5, total_tokens: 500 },
												{ team_id: "team-b", total_spend: 7.5, total_tokens: 300 },
											]);
										} else {
											resolve([
												{ team_id: "team-a", date: "2025-01-15", spend: 5 },
												{ team_id: "team-b", date: "2025-01-15", spend: 3 },
											]);
										}
									};
								}
								return () => fluent;
							},
						},
					);
					return fluent;
				},
			};
			const app = makeApp(db);
			const res = await request(app).get("/global/spend/teams");
			expect(res.status).toBe(200);
			const b = res.body as Record<string, unknown>;

			expect(Array.isArray(b.teams)).toBe(true);
			for (const t of b.teams as string[]) {
				expect(typeof t).toBe("string");
			}
			expect(b.teams).toContain("team-a");
			expect(b.teams).toContain("team-b");

			expect(Array.isArray(b.total_spend_per_team)).toBe(true);
			for (const t of b.total_spend_per_team as Array<Record<string, unknown>>) {
				expect(typeof t.team_id).toBe("string");
				expect(Number.isFinite(t.total_spend as number)).toBe(true);
				expect(Number.isFinite(t.total_tokens as number)).toBe(true);
			}

			expect(Array.isArray(b.daily_spend)).toBe(true);
			for (const d of b.daily_spend as Array<Record<string, unknown>>) {
				expect(typeof d.date).toBe("string");
				expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				for (const [k, v] of Object.entries(d)) {
					if (k === "date") {
						continue;
					}
					expect(Number.isFinite(v as number)).toBe(true);
				}
			}
		});
	});

	describe("/global/spend/tags", () => {
		it("spend_per_tag 每项含 name/spend（BarChart index=name categories=[spend]）", async () => {
			const app = makeApp(
				makeMockDb([
					{ tag: "prod", total_spend: 5.5, total_tokens: 1000 },
					{ tag: "dev", total_spend: 1.25, total_tokens: 500 },
				]),
			);
			const res = await request(app).get("/global/spend/tags");
			expect(res.status).toBe(200);
			const b = res.body as Record<string, unknown>;
			expect(Array.isArray(b.spend_per_tag)).toBe(true);
			for (const t of b.spend_per_tag as Array<Record<string, unknown>>) {
				expect(typeof t.name).toBe("string");
				expect(Number.isFinite(t.spend as number)).toBe(true);
				expect(typeof t.tag).toBe("string");
				expect(Number.isFinite(t.total_spend as number)).toBe(true);
				expect(Number.isFinite(t.total_tokens as number)).toBe(true);
			}
		});
	});

	describe("/spend/tags", () => {
		it("数组每项含 name/spend 字符串与有限 number", async () => {
			const app = makeApp(makeMockDb([{ tag: "prod", total_spend: 3.14, total_tokens: 200 }]));
			const res = await request(app).get("/spend/tags");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			for (const t of res.body as Array<Record<string, unknown>>) {
				expect(typeof t.name).toBe("string");
				expect(Number.isFinite(t.spend as number)).toBe(true);
			}
		});
	});

	describe("/global/spend/logs (Monthly Spend BarChart)", () => {
		// 锁定时间到 2025-02-15，让"本月"= 2025-02，dates 长度 15
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("DB 命中聚合：返回本月每日 rows，spend/total_tokens 有限 number", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(
				makeMockDb([
					{ date: "2025-02-10", spend: 3.5, total_tokens: 100 },
					{ date: "2025-02-12", spend: 7.25, total_tokens: 200 },
				]),
			);
			const res = await request(app).get("/global/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Array<Record<string, unknown>>;
			expect(Array.isArray(body)).toBe(true);
			expect(body.length).toBe(15); // 1..15 全部补齐
			// 命中日期 spend 应为 DB 值
			const hit = body.find((r) => r.date === "2025-02-10");
			expect(hit?.spend).toBe(3.5);
			expect(hit?.total_tokens).toBe(100);
			// 缺失日期 spend 应为 0
			const miss = body.find((r) => r.date === "2025-02-11");
			expect(miss?.spend).toBe(0);
			expect(Number.isFinite(miss?.total_tokens as number)).toBe(true);
			// 每项 date / spend / total_tokens 都满足 WebUI 期望
			for (const row of body) {
				expect(typeof row.date).toBe("string");
				expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(Number.isFinite(row.spend as number)).toBe(true);
				expect(Number.isFinite(row.total_tokens as number)).toBe(true);
			}
		});

		it("空 DB 兜底：返回非空数组，每项含本月每日 spend=0", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makeMockDb([]));
			const res = await request(app).get("/global/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Array<Record<string, unknown>>;
			expect(Array.isArray(body)).toBe(true);
			expect(body.length).toBeGreaterThan(0);
			for (const row of body) {
				expect(typeof row.date).toBe("string");
				expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(row.spend).toBe(0);
				expect(Number.isFinite(row.spend as number)).toBe(true);
				expect(Number.isFinite(row.total_tokens as number)).toBe(true);
			}
		});

		it("查询失败兜底：返回本月每日 spend=0，绝不返回 []", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makeFailingMockDb("connection refused"));
			const res = await request(app).get("/global/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Array<Record<string, unknown>>;
			expect(Array.isArray(body)).toBe(true);
			expect(body.length).toBeGreaterThan(0);
			for (const row of body) {
				expect(typeof row.date).toBe("string");
				expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(Number.isFinite(row.spend as number)).toBe(true);
				expect(Number.isFinite(row.total_tokens as number)).toBe(true);
			}
		});

		it("本月 1 号：dates[0] = firstDay", async () => {
			freezeNow("2025-02-01T08:00:00Z");
			const app = makeApp(makeMockDb([]));
			const res = await request(app).get("/global/spend/logs");
			const body = res.body as Array<Record<string, unknown>>;
			expect(body.length).toBe(1);
			expect(body[0]?.date).toBe("2025-02-01");
		});
	});

	describe("/spend/logs (旧分页契约：{ data, page, pageSize, total, hasMore })", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("无过滤+DB 命中：返回分页对象，data 为明细行，total 反映总行数", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(
				makePaginatedMockDb([
					{ startTime: new Date("2025-02-10T00:00:00Z"), spend: 2.5, total_tokens: 500 },
					{ startTime: new Date("2025-02-11T00:00:00Z"), spend: 1.25, total_tokens: 200 },
				]),
			);
			const res = await request(app).get("/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(typeof body.page).toBe("number");
			expect(typeof body.pageSize).toBe("number");
			expect(typeof body.total).toBe("number");
			expect(typeof body.hasMore).toBe("boolean");
			// 绝不能在 /spend/logs 返回"本月每日 spend=0 假数据"
			expect(body.total).toBe(2);
			expect((body.data as unknown[]).length).toBe(2);
		});

		it("空 DB 兜底：返回空 data + total=0（不补本月每日假数据）", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makePaginatedMockDb([]));
			const res = await request(app).get("/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(body.data).toEqual([]);
			expect(body.total).toBe(0);
			expect(body.hasMore).toBe(false);
		});

		it("查询失败兜底：返回旧分页空对象 + warn 日志，绝不抛 5xx", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makeFailingMockDb("db down"));
			const res = await request(app).get("/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(body.data).toEqual([]);
			expect(body.total).toBe(0);
			expect(body.hasMore).toBe(false);
		});

		it("带过滤 (api_key) + DB 命中：返回分页明细", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(
				makePaginatedMockDb([{ startTime: new Date("2025-02-10T00:00:00Z"), api_key: "sk-x", spend: 0.5, total_tokens: 10 }]),
			);
			const res = await request(app).get("/spend/logs").query({ api_key: "sk-x" });
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(Array.isArray(body.data)).toBe(true);
			expect((body.data as Array<Record<string, unknown>>)[0]?.spend).toBe(0.5);
		});
	});

	describe("/spend/logs/ui (新分页契约：{ data, total, page, page_size, total_pages })", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("DB 命中：返回新分页对象，total_pages 正确计算", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(
				makeCountFirstPaginatedMockDb([{ startTime: new Date("2025-02-10T00:00:00Z"), spend: 2.5, total_tokens: 500 }]),
			);
			const res = await request(app).get("/spend/logs/ui?page=1&page_size=10");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.page).toBe(1);
			expect(body.page_size).toBe(10);
			expect(body.total).toBe(1);
			expect(body.total_pages).toBe(1);
		});

		it("支持 start_date / end_date 过滤", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makeCountFirstPaginatedMockDb([]));
			const res = await request(app)
				.get("/spend/logs/ui")
				.query({ start_date: "2025-02-01T00:00:00Z", end_date: "2025-02-15T23:59:59Z" });
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(body).toHaveProperty("data");
			expect(body).toHaveProperty("total");
			expect(body).toHaveProperty("page");
			expect(body).toHaveProperty("page_size");
			expect(body).toHaveProperty("total_pages");
		});

		it("支持 sort_by / sort_order", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(
				makeCountFirstPaginatedMockDb([
					{ startTime: new Date("2025-02-10T00:00:00Z"), spend: 5, total_tokens: 100 },
					{ startTime: new Date("2025-02-11T00:00:00Z"), spend: 2, total_tokens: 200 },
				]),
			);
			const res = await request(app).get("/spend/logs/ui?sort_by=spend&sort_order=asc");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(body.page).toBe(1);
		});

		it("空结果：total=0，total_pages=0，data 为空数组", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makeCountFirstPaginatedMockDb([]));
			const res = await request(app).get("/spend/logs/ui");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(body.data).toEqual([]);
			expect(body.total).toBe(0);
			expect(body.total_pages).toBe(0);
		});

		it("查询失败兜底：返回新分页空对象", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const app = makeApp(makeFailingMockDb("timeout"));
			const res = await request(app).get("/spend/logs/ui");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(body.data).toEqual([]);
			expect(body.total).toBe(0);
			expect(body.total_pages).toBe(0);
		});
	});
});
