/**
 * 花费管理端点响应 shape 与 Python LiteLLM parity 测试
 *
 * 目标：
 * 1. SpendManagementEndpoint 返回的字段类型与 WebUI Tremor BarChart 期望一致，
 *    避免 `<rect> attribute y: Expected length, "NaN"` 之类的运行时错误。
 * 2. `/spend/logs/ui` 与 `/spend/logs/v2` 严格对齐 Python LiteLLM：
 *    - 必填 start_date / end_date；UI 只接受 `YYYY-MM-DD HH:MM:SS`，v2 同时接受 `YYYY-MM-DD`。
 *    - sort_by 白名单 + 非法 400；sort_order 白名单 + 非法 400。
 *    - 过滤：api_key / user_id / request_id / team_id / model / model_id / end_user /
 *      min_spend / max_spend / status_filter / key_alias / error_code / error_message。
 *    - 权限：proxy_admin 全可见；internal_user 未传 team 强制看自己 user；team admin 看本 team；普通用户 403。
 *    - UI 响应含 session_total_count；v2 不含。
 *    - DB 异常时不再静默返回空分页。
 *    - 主查询显式列投影，排除 messages / response / proxy_server_request；standard_logging_object 不属于 Python schema。
 */

import express from "express";
import request from "supertest";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { registerSpendManagementEndpoints } from "./SpendManagementEndpoint";
import type { UserAPIKeyAuth } from "../types/auth";

/**
 * 通用轻量 Drizzle mock。
 *
 * 通过 builder 顺序记录 `.select(...)` 投影、`.where(...)` SQL、
 * `.orderBy(...)` 文本、`.limit(...)` / `.offset(...)` / `.groupBy(...)` 值，
 * 并按调用顺序从 FIFO 队列取出预置响应。每次 await 都会消耗队列中一项。
 */
interface RecordedCall {
	readonly projection: ReadonlyArray<string>;
	readonly whereSql: string | null;
	readonly orderSql: string | null;
	readonly limitN: number | null;
	readonly offsetN: number | null;
	readonly groupByCols: ReadonlyArray<string>;
	readonly hasCount: boolean;
}

function describeObject(value: unknown): string {
	if (value === undefined) {
		return "<undefined>";
	}
	// 优先尝试 JSON.stringify：Drizzle SQL / and() / eq() 对象含可枚举属性
	// （queryChunks / 列名 / 字符串值），可被 JSON.stringify 序列化为含列名+字面量的字符串。
	try {
		const serialized = JSON.stringify(value);
		if (serialized !== undefined) {
			return serialized;
		}
	} catch {
		// fall through to manual walk
	}
	// 兜底：手动遍历 queryChunks 抽出字符串与列名。
	const visited = new WeakSet<object>();
	const walk = (node: unknown, out: string[]): void => {
		if (node === null || node === undefined) {
			return;
		}
		if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
			out.push(String(node));
			return;
		}
		if (typeof node !== "object") {
			return;
		}
		if (visited.has(node as object)) {
			return;
		}
		visited.add(node as object);
		const obj = node as Record<string, unknown>;
		if (Array.isArray(obj.queryChunks)) {
			walk(obj.queryChunks, out);
		}
		if (typeof obj.name === "string") {
			out.push(`col:${obj.name}`);
		}
		if (typeof obj.value === "string" || typeof obj.value === "number") {
			out.push(String(obj.value));
		}
		for (const [k, v] of Object.entries(obj)) {
			if (k === "queryChunks" || k === "name" || k === "value" || k === "decoder") {
				continue;
			}
			walk(v, out);
		}
	};
	const out: string[] = [];
	walk(value, out);
	return out.join(" | ") || String(value);
}

/** 单个 builder 的 state：select() 一次性确定 projection，后续链式调用不断累积。 */
interface BuilderState {
	projection: string[];
	whereSql: string | null;
	orderSql: string | null;
	limitN: number | null;
	offsetN: number | null;
	groupByCols: string[];
}

interface MockDbOptions {
	/**
	 * 按 await 顺序排列的响应队列。每次 `.then()` 调用消耗队列头一项。
	 * 未配置时回退到按以下优先级的具名队列：teamRows / count / sessionCounts / data。
	 */
	readonly responses?: unknown[];
	readonly data?: unknown[];
	readonly count?: Array<{ count: number }>;
	readonly sessionCounts?: Array<{ session_id: string; total: number }>;
	readonly teamRows?: Array<{ admins?: string[]; membersWithRoles?: Record<string, { role?: string }> }>;
	readonly error?: Error;
}

interface MockDb {
	db: unknown;
	calls: RecordedCall[];
	/** 强制在第 N 次 await（1-based）后抛错，用于覆盖部分 enrichment 失败 */
	failAfter: (n: number) => void;
}

function makeMockDb(options: MockDbOptions = {}): MockDb {
	const calls: RecordedCall[] = [];
	// 具名子队列：按 handler 调用顺序消耗。order:
	//   1) teamRows（仅在需要 team 可见性检查时）
	//   2) count
	//   3) data（主查询）
	//   4) sessionCounts（enrichment）
	const namedQueues: Record<string, { values: unknown[]; multi: boolean }> = {
		// teamRows / count / sessionCounts 每条 await 各消耗一项（多个 await 按顺序回放）。
		teamRows: { values: options.teamRows ? [...options.teamRows] : [], multi: true },
		count: { values: options.count ? [...options.count] : [{ count: 0 }], multi: true },
		sessionCounts: { values: options.sessionCounts ? [...options.sessionCounts] : [], multi: true },
		// data 队列的元素本身就是 await 的完整结果（行数组）。
		// 测试中通常一次 await 返回所有行；多 await 场景请改用 responses 显式指定。
		data: { values: options.data ? [options.data] : [], multi: false },
	};
	// 合并到 FIFO：当 responses 配置存在时优先消耗它（每次 await 消耗一个项）。
	const fifo: unknown[] = options.responses ? [...options.responses] : [];
	const baseError = options.error ?? null;
	let awaitCount = 0;
	let failAt = baseError ? 1 : Number.POSITIVE_INFINITY;

	const reset = (state: BuilderState): void => {
		state.projection = [];
		state.whereSql = null;
		state.orderSql = null;
		state.limitN = null;
		state.offsetN = null;
		state.groupByCols = [];
	};

	const newBuilder = (initialProjection: string[] = []): BuilderState => ({
		projection: initialProjection,
		whereSql: null,
		orderSql: null,
		limitN: null,
		offsetN: null,
		groupByCols: [],
	});

	const classify = (proj: ReadonlyArray<string>, groupBy: ReadonlyArray<string>): keyof typeof namedQueues | "fifo" => {
		if (proj.length === 2 && proj.includes("admins") && proj.includes("membersWithRoles")) {
			return "teamRows";
		}
		if (proj.length === 1 && proj[0] === "count") {
			return "count";
		}
		if (proj.includes("session_id") && groupBy.length > 0) {
			return "sessionCounts";
		}
		// 默认回落到 data 队列：覆盖以下生产端点
		//   - /spend/logs 旧分页（db.select() 空 projection）
		//   - /global/activity、/global/activity/model（含 date + api_requests）
		//   - /spend/logs/ui、/spend/logs/v2（含 api_key/request_id/spend）
		return "data";
	};

	const applyThen = (state: BuilderState, resolve: (v: unknown) => void, reject: (e: unknown) => void): void => {
		awaitCount += 1;
		const proj = [...state.projection];
		const groupBy = [...state.groupByCols];
		const hasCount = proj.length === 1 && proj[0] === "count";
		if (awaitCount >= failAt) {
			calls.push({
				projection: proj,
				whereSql: state.whereSql,
				orderSql: state.orderSql,
				limitN: state.limitN,
				offsetN: state.offsetN,
				groupByCols: groupBy,
				hasCount: hasCount,
			});
			reset(state);
			reject(new Error("mocked db failure"));
			return;
		}
		let value: unknown;
		if (fifo.length > 0) {
			value = fifo.shift();
		} else {
			const kind = classify(proj, groupBy);
			if (kind === "fifo") {
				value = [];
			} else {
				const queue = namedQueues[kind];
				if (!queue) {
					value = [];
				} else if (queue.multi) {
					// multi 模式：每条 await 消耗一个值；未配置时按队列类型兜底（count 默认 [{count:0}]、其他 []）。
					const raw = queue.values.length > 0 ? queue.values.shift() : kind === "count" ? [{ count: 0 }] : [];
					value = Array.isArray(raw) ? raw : [raw];
				} else {
					// 单元模式（data 队列）：整个数组是单次 await 的结果，未配置返回 []。
					value = queue.values.length > 0 ? queue.values[0] : [];
				}
			}
		}
		calls.push({
			projection: proj,
			whereSql: state.whereSql,
			orderSql: state.orderSql,
			limitN: state.limitN,
			offsetN: state.offsetN,
			groupByCols: groupBy,
			hasCount: hasCount,
		});

		reset(state);
		resolve(value);
	};

	// 每个 select() 调用都创建一个新的 builder，拥有独立 state。
	// 这样当生产代码 `const dataQuery = db.select(...).from(...)` 先建好数据查询链，
	// 再调用 `db.select(...).where(...).then()` 做 count 查询时，两条链的 state 不会互相覆盖。
	const buildProxy = (state: BuilderState): unknown =>
		new Proxy(
			{},
			{
				get: (_t, prop) => {
					if (prop === "select") {
						return (spec?: Record<string, unknown>) => {
							const childState = newBuilder(spec ? Object.keys(spec) : []);
							return buildProxy(childState);
						};
					}
					if (typeof prop === "symbol") {
						return undefined;
					}
					if (prop === "then") {
						return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => applyThen(state, resolve, reject);
					}
					if (prop === "_calls") {
						return calls;
					}
					if (prop === "_failAfter") {
						return (n: number) => {
							failAt = n;
						};
					}
					return (...args: unknown[]) => {
						if (prop === "where") {
							state.whereSql = args[0] === undefined ? null : describeObject(args[0]);
						} else if (prop === "orderBy") {
							state.orderSql = describeObject(args[0]);
						} else if (prop === "limit") {
							state.limitN = args[0] as number;
						} else if (prop === "offset") {
							state.offsetN = args[0] as number;
						} else if (prop === "groupBy") {
							state.groupByCols = (args as Array<{ name?: string }>).map((c) => c.name ?? "<col>");
						}
						return buildProxy(state);
					};
				},
			},
		);

	const rootState = newBuilder();
	const proxy = buildProxy(rootState);

	return {
		db: proxy,
		calls: calls,
		failAfter: (n: number) => {
			failAt = n;
		},
	};
}

/** /spend/logs/ui 测试用数据 — 含 session_id 让 enrichment 能命中 */
const SAMPLE_UI_ROW = {
	request_id: "req-1",
	call_type: "completion",
	api_key: "sk-test",
	spend: 0.5,
	total_tokens: 100,
	prompt_tokens: 60,
	completion_tokens: 40,
	startTime: new Date("2025-02-10T00:00:00Z"),
	endTime: new Date("2025-02-10T00:01:00Z"),
	model: "gpt-4",
	model_id: "gpt-4-0613",
	model_group: "gpt-4",
	custom_llm_provider: "openai",
	api_base: "https://api.openai.com",
	user: "user-1",
	metadata: {},
	cache_hit: "",
	cache_key: "",
	request_tags: [],
	team_id: null,
	organization_id: null,
	end_user: null,
	requester_ip_address: null,
	session_id: "session-A",
	status: "success",
	mcp_namespaced_tool_name: null,
	agent_id: null,
	request_duration_ms: 1000,
};

function makeAppWithAuth(db: unknown, auth?: UserAPIKeyAuth): express.Express {
	const app = express();
	app.use(express.json());
	const passThroughAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
		if (auth) {
			req.auth = auth;
		}
		next();
	};
	const router = express.Router();
	router.use(passThroughAuth);
	registerSpendManagementEndpoints(router, db as never);
	app.use(router);
	return app;
}

function freezeNow(iso: string): jest.SpyInstance {
	const fixed = new Date(iso);
	const OriginalDate = Date;
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

const PROXY_ADMIN_AUTH: UserAPIKeyAuth = {
	api_key: "sk-test-master",
	user_id: "default_user_id",
	user_role: "proxy_admin",
};

const INTERNAL_USER_AUTH: UserAPIKeyAuth = {
	api_key: "sk-test-internal",
	user_id: "internal-user-1",
	user_role: "internal_user",
};

describe("SpendManagementEndpoint — 响应 shape 兼容 WebUI Tremor BarChart", () => {
	describe("/global/spend/keys", () => {
		it("returns every aggregated key without applying a SQL limit", async () => {
			const { db, calls } = makeMockDb({
				data: [
					{ api_key: "sk-first", total_spend: 10, total_tokens: 100 },
					{ api_key: "sk-last", total_spend: 1, total_tokens: 10 },
				],
			});
			const res = await request(makeAppWithAuth(db)).get("/global/spend/keys?limit=1");
			expect(res.status).toBe(200);
			expect(res.body).toHaveLength(2);
			expect(calls[0]?.limitN).toBeNull();
		});
	});
	describe("/global/activity", () => {
		it("顶层严格对齐 Python/WebUI shape，且 sum_api_requests / sum_total_tokens 为有限 number", async () => {
			const { db } = makeMockDb({
				data: [
					{ date: "2025-01-15", api_requests: 10, total_tokens: 2000 },
					{ date: "2025-01-16", api_requests: 20, total_tokens: 4000 },
				],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/global/activity?start_date=2025-01-01&end_date=2025-01-31");
			expect(res.status).toBe(200);
			const b = res.body as Record<string, unknown>;
			expect(Object.keys(b).sort()).toEqual(["daily_data", "sum_api_requests", "sum_total_tokens"]);
			expect(Array.isArray(b.daily_data)).toBe(true);
			expect(Number.isFinite(b.sum_api_requests as number)).toBe(true);
			expect(Number.isFinite(b.sum_total_tokens as number)).toBe(true);
			expect(b.sum_api_requests).toBe(30);
			expect(b.sum_total_tokens).toBe(6000);
			for (const d of b.daily_data as Array<Record<string, unknown>>) {
				expect(Object.keys(d).sort()).toEqual(["api_requests", "date", "total_tokens"]);
				expect(typeof d.date).toBe("string");
				expect(Number.isFinite(d.api_requests as number)).toBe(true);
				expect(Number.isFinite(d.total_tokens as number)).toBe(true);
			}
		});

		it("空结果兜底：所有 sum_* = 0", async () => {
			const { db } = makeMockDb({ data: [] });
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/global/activity?start_date=2025-01-01&end_date=2025-01-31");
			expect(res.status).toBe(200);
			const b = res.body as Record<string, unknown>;
			expect(Object.keys(b).sort()).toEqual(["daily_data", "sum_api_requests", "sum_total_tokens"]);
			expect(b.daily_data).toEqual([]);
			expect(b.sum_api_requests).toBe(0);
			expect(b.sum_total_tokens).toBe(0);
		});
	});
	describe("/global/activity/model", () => {
		it("每 model 含 sum_api_requests/sum_total_tokens；daily_data 字段为 api_requests/total_tokens", async () => {
			const { db } = makeMockDb({
				data: [
					{ model_group: "gpt-4", date: "2025-01-15", api_requests: 5, total_tokens: 100 },
					{ model_group: "gpt-4", date: "2025-01-16", api_requests: 7, total_tokens: 200 },
					{ model_group: "claude", date: "2025-01-15", api_requests: 3, total_tokens: 50 },
				],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/global/activity/model?start_date=2025-01-01&end_date=2025-01-31");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			for (const m of res.body as Array<Record<string, unknown>>) {
				expect(typeof m.model).toBe("string");
				expect(Number.isFinite(m.sum_api_requests as number)).toBe(true);
				expect(Number.isFinite(m.sum_total_tokens as number)).toBe(true);
				expect(Array.isArray(m.daily_data)).toBe(true);
				for (const d of m.daily_data as Array<Record<string, unknown>>) {
					expect(typeof d.date).toBe("string");
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
			const fluent: any = new Proxy(
				{},
				{
					get: (_t, prop) => {
						if (prop === "then") {
							return (resolve: (v: unknown) => void) => {
								if (callCount === 0) {
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
								callCount++;
							};
						}
						return () => fluent;
					},
				},
			);
			const db: any = { select: () => fluent };
			const app = makeAppWithAuth(db);
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
			const { db } = makeMockDb({
				data: [
					{ tag: "prod", total_spend: 5.5, total_tokens: 1000 },
					{ tag: "dev", total_spend: 1.25, total_tokens: 500 },
				],
			});
			const app = makeAppWithAuth(db);
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
		it("按 request tag 聚合：每项仅含 individual_request_tag/log_count/total_spend（对齐 Python get_spend_by_tags）", async () => {
			const { db } = makeMockDb({
				data: [{ individual_request_tag: "prod", log_count: 205, total_spend: 6.6 }],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/spend/tags");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body)).toBe(true);
			for (const t of res.body as Array<Record<string, unknown>>) {
				expect(Object.keys(t).sort()).toEqual(["individual_request_tag", "log_count", "total_spend"]);
				expect(typeof t.individual_request_tag).toBe("string");
				expect(Number.isFinite(t.log_count as number)).toBe(true);
				expect(Number.isFinite(t.total_spend as number)).toBe(true);
			}
		});
	});

	describe("/global/spend/logs (Python MonthlyGlobalSpend 语义)", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("DB 命中聚合：仅返回有数据日期，每项仅含 date/spend，不零填充", async () => {
			const { db } = makeMockDb({
				data: [
					{ date: "2025-02-10", spend: 3.5 },
					{ date: "2025-02-12", spend: 7.25 },
				],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/global/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Array<Record<string, unknown>>;
			expect(Array.isArray(body)).toBe(true);
			expect(body.length).toBe(2);
			for (const row of body) {
				expect(Object.keys(row).sort()).toEqual(["date", "spend"]);
				expect(typeof row.date).toBe("string");
				expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(Number.isFinite(row.spend as number)).toBe(true);
			}
		});

		it("空 DB：返回空数组（不补 spend=0 占位行）", async () => {
			const { db } = makeMockDb({ data: [] });
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/global/spend/logs");
			expect(res.status).toBe(200);
			expect(res.body).toEqual([]);
		});

		it("api_key 过滤：行内补 api_key 字段（对齐 MonthlyGlobalSpendPerKey）", async () => {
			const { db } = makeMockDb({
				data: [{ date: "2025-02-10", spend: 3.5, api_key: "sk-abc" }],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/global/spend/logs?api_key=sk-abc");
			expect(res.status).toBe(200);
			const body = res.body as Array<Record<string, unknown>>;
			expect(body.length).toBe(1);
			expect(Object.keys(body[0] as Record<string, unknown>).sort()).toEqual(["api_key", "date", "spend"]);
			expect(body[0]?.api_key).toBe("sk-abc");
		});
	});

	describe("/spend/logs (旧分页契约)", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("无过滤+DB 命中：返回分页对象", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const { db } = makeMockDb({
				data: [
					{ startTime: new Date("2025-02-10T00:00:00Z"), spend: 2.5, total_tokens: 500 },
					{ startTime: new Date("2025-02-11T00:00:00Z"), spend: 1.25, total_tokens: 200 },
				],
				count: [{ count: 2 }],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/spend/logs");
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(typeof body.page).toBe("number");
			expect(typeof body.pageSize).toBe("number");
			expect(typeof body.total).toBe("number");
			expect(typeof body.hasMore).toBe("boolean");
			expect(body.total).toBe(2);
		});

		it("带过滤 (api_key) + DB 命中：返回分页明细", async () => {
			freezeNow("2025-02-15T12:00:00Z");
			const { db } = makeMockDb({
				data: [{ startTime: new Date("2025-02-10T00:00:00Z"), api_key: "sk-x", spend: 0.5, total_tokens: 10 }],
				count: [{ count: 1 }],
			});
			const app = makeAppWithAuth(db);
			const res = await request(app).get("/spend/logs").query({ api_key: "sk-x" });
			expect(res.status).toBe(200);
			const body = res.body as Record<string, unknown>;
			expect(Array.isArray(body.data)).toBe(true);
			expect((body.data as Array<Record<string, unknown>>)[0]?.spend).toBe(0.5);
		});
	});

	describe("/spend/logs/ui & /spend/logs/v2 — Python parity", () => {
		afterEach(() => {
			jest.restoreAllMocks();
		});

		describe("参数校验", () => {
			it("缺 start_date 返回 400", async () => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(400);
			});

			it("缺 end_date 返回 400", async () => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00");
				expect(res.status).toBe(400);
			});

			it("UI 路径只接受 YYYY-MM-DD HH:MM:SS，传 YYYY-MM-DD 返回 400", async () => {
				const { db } = makeMockDb({ data: [], count: [{ count: 0 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01&end_date=2025-02-15");
				expect(res.status).toBe(400);
			});

			it("/spend/logs/v2 接受 YYYY-MM-DD", async () => {
				const { db } = makeMockDb({
					data: [SAMPLE_UI_ROW],
					count: [{ count: 1 }],
				});
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/v2?start_date=2025-02-01&end_date=2025-02-15");
				expect(res.status).toBe(200);
				const body = res.body as Record<string, unknown>;
				expect(body.total).toBe(1);
			});

			it("/spend/logs/v2 也接受 YYYY-MM-DD HH:MM:SS", async () => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/v2?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
			});

			it("非法 sort_by 返回 400", async () => {
				const { db } = makeMockDb({ data: [], count: [{ count: 0 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&sort_by=hacker_field",
				);
				expect(res.status).toBe(400);
			});

			it("非法 sort_order 返回 400", async () => {
				const { db } = makeMockDb({ data: [], count: [{ count: 0 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&sort_order=sideways",
				);
				expect(res.status).toBe(400);
			});

			it("非数字 min_spend 返回 400", async () => {
				const { db } = makeMockDb({ data: [], count: [{ count: 0 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&min_spend=cheap",
				);
				expect(res.status).toBe(400);
			});
		});

		describe("sort_by 白名单", () => {
			for (const field of ["spend", "total_tokens", "startTime", "endTime", "request_duration_ms"]) {
				it(`sort_by=${field} 通过`, async () => {
					const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
					const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
					const res = await request(app).get(
						`/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&sort_by=${field}`,
					);
					expect(res.status).toBe(200);
				});
			}
		});

		describe("过滤", () => {
			it.each([
				["api_key", "sk-test"],
				["user_id", "user-1"],
				["request_id", "req-1"],
				["team_id", "team-1"],
				["model", "gpt-4"],
				["model_id", "gpt-4-0613"],
				["end_user", "end-user-1"],
			])("%s 过滤通过", async (filterKey, filterValue) => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					`/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&${filterKey}=${filterValue}`,
				);
				expect(res.status).toBe(200);
			});

			it("min_spend / max_spend 范围过滤", async () => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&min_spend=0.1&max_spend=2",
				);
				expect(res.status).toBe(200);
			});

			it("status_filter=success 通过", async () => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&status_filter=success",
				);
				expect(res.status).toBe(200);
			});

			it.each([
				["key_alias", "alias"],
				["error_code", "404"],
				["error_message", "timeout"],
			])("metadata 过滤 %s 通过", async (filterKey, filterValue) => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					`/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&${filterKey}=${filterValue}`,
				);
				expect(res.status).toBe(200);
			});
		});

		describe("显式列投影", () => {
			it("主查询选择 Python UI 列；不选择重 JSON 列和 Python schema 不存在字段", async () => {
				const { db, calls } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
				const dataCall = calls.find((c) => c.projection.includes("request_id") && c.projection.includes("spend"));
				expect(dataCall).toBeDefined();
				const proj = dataCall!.projection;
				expect(proj).toContain("request_id");
				expect(proj).toContain("api_key");
				expect(proj).toContain("spend");
				expect(proj).toContain("startTime");
				expect(proj).toContain("endTime");
				expect(proj).toContain("session_id");
				expect(proj).toContain("status");
				expect(proj).toContain("team_id");
				expect(proj).toContain("user");
				expect(proj).toContain("end_user");
				expect(proj).not.toContain("messages");
				expect(proj).not.toContain("response");
				expect(proj).not.toContain("proxy_server_request");
				expect(proj).not.toContain("standard_logging_object");
			});

			it("orderBy + limit + offset 正确应用", async () => {
				const { db, calls } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 5 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&page=2&page_size=10&sort_by=spend&sort_order=asc",
				);
				expect(res.status).toBe(200);
				const dataCall = calls.find((c) => c.limitN === 10);
				expect(dataCall).toBeDefined();
				expect(dataCall!.offsetN).toBe(10);
				expect(dataCall!.orderSql).not.toBeNull();
			});
		});

		describe("分页大小", () => {
			it("page_size=1001 clamps to 1000 with matching query and response metadata", async () => {
				const { db, calls } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&page=2&page_size=1001",
				);

				expect(res.status).toBe(200);
				expect(calls.find((call) => call.limitN === 1000)?.offsetN).toBe(1000);
				expect(res.body).toMatchObject({ page: 2, page_size: 1000, total: 1, total_pages: 1 });
			});
		});

		describe("日志详情", () => {
			it("/spend/logs/ui/:request_id 返回详情抽屉需要的重 JSON 列", async () => {
				const detailRow = {
					messages: [{ role: "user", content: "hello" }],
					response: { id: "chatcmpl-test" },
					proxy_server_request: { model: "gpt-5.5" },
				};
				const { db } = makeMockDb({ data: [detailRow] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);

				const res = await request(app).get("/spend/logs/ui/req-1?start_date=2025-02-01 00:00:00");

				expect(res.status).toBe(200);
				expect(res.body).toEqual(detailRow);
			});
		});

		describe("session_total_count enrichment", () => {
			it("UI 响应每行含 session_total_count；DB 返回 session count 时使用真实值", async () => {
				const { db } = makeMockDb({
					data: [SAMPLE_UI_ROW],
					count: [{ count: 1 }],
					sessionCounts: [{ session_id: "session-A", total: 4 }],
				});
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
				const body = res.body as Record<string, unknown>;
				const data = body.data as Array<Record<string, unknown>>;
				expect(data[0]?.session_total_count).toBe(4);
			});

			it("UI 路径无 session_id 行 session_total_count=1", async () => {
				const rowWithoutSession = { ...SAMPLE_UI_ROW, session_id: null };
				const { db } = makeMockDb({ data: [rowWithoutSession], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
				const body = res.body as Record<string, unknown>;
				const data = body.data as Array<Record<string, unknown>>;
				expect(data[0]?.session_total_count).toBe(1);
			});

			it("v2 响应不含 session_total_count", async () => {
				const { db } = makeMockDb({
					data: [SAMPLE_UI_ROW],
					count: [{ count: 1 }],
					sessionCounts: [{ session_id: "session-A", total: 4 }],
				});
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/v2?start_date=2025-02-01&end_date=2025-02-15");
				expect(res.status).toBe(200);
				const body = res.body as Record<string, unknown>;
				const data = body.data as Array<Record<string, unknown>>;
				expect(data[0]).not.toHaveProperty("session_total_count");
			});
		});

		describe("权限裁剪", () => {
			it("proxy_admin 可看全部", async () => {
				const { db } = makeMockDb({ data: [SAMPLE_UI_ROW], count: [{ count: 1 }] });
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
			});

			it("internal_user 未传 team 时强制 user=自己", async () => {
				const { db, calls } = makeMockDb({ data: [], count: [{ count: 0 }] });
				const app = makeAppWithAuth(db, INTERNAL_USER_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
				const countCall = calls.find((c) => c.hasCount);
				expect(countCall?.whereSql).toContain("internal-user-1");
			});

			it("team admin 可看本 team", async () => {
				const teamAdminAuth: UserAPIKeyAuth = {
					api_key: "sk-test",
					user_id: "team-admin-1",
					user_role: "internal_user",
				};
				const { db } = makeMockDb({
					data: [],
					count: [{ count: 0 }],
					teamRows: [{ admins: ["team-admin-1"], membersWithRoles: {} }],
				});
				const app = makeAppWithAuth(db, teamAdminAuth);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&team_id=team-1",
				);
				expect(res.status).toBe(200);
			});

			it("team member 看不可见 team 返回 403", async () => {
				const teamMemberAuth: UserAPIKeyAuth = {
					api_key: "sk-test",
					user_id: "team-member-1",
					user_role: "internal_user",
				};
				const { db } = makeMockDb({
					data: [],
					count: [{ count: 0 }],
					teamRows: [{ admins: ["other-admin"], membersWithRoles: { "team-member-1": { role: "member" } } }],
				});
				const app = makeAppWithAuth(db, teamMemberAuth);
				const res = await request(app).get(
					"/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59&team_id=team-1",
				);
				expect(res.status).toBe(403);
			});
		});

		describe("错误语义", () => {
			it("DB 查询失败返回 500，不再伪装空分页", async () => {
				const { db } = makeMockDb({
					error: new Error("connection refused"),
				});
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(500);
			});

			it("session_count enrichment 失败时返回 200 且 session_total_count=1", async () => {
				const { db, failAfter } = makeMockDb({
					data: [SAMPLE_UI_ROW],
					count: [{ count: 1 }],
				});
				// count(1) + data(2) 后，enrichment 的 select 是第 3 次
				failAfter(3);
				const app = makeAppWithAuth(db, PROXY_ADMIN_AUTH);
				const res = await request(app).get("/spend/logs/ui?start_date=2025-02-01 00:00:00&end_date=2025-02-15 23:59:59");
				expect(res.status).toBe(200);
				const body = res.body as Record<string, unknown>;
				const data = body.data as Array<Record<string, unknown>>;
				expect(data[0]?.session_total_count).toBe(1);
			});
		});
	});
});
