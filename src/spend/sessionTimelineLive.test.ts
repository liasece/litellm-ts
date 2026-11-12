import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type * as schema from "../db/schema";
import type { SessionTimelineItem, SessionTimelinePart, SessionTimelineSourceRow } from "./sessionTimeline";
import { publishLiveResponse, registerLiveResponse, resetLiveResponseRegistry } from "./LiveResponseRegistry";
import { parseSessionPosition, type SessionPosition } from "./sessionPosition";
import {
	SESSION_TIMELINE_MAX_INLINE_IMAGE_CHARS,
	compactSessionTimelinePayload,
	createSessionTimelineStreamState,
	selectForwardTimelineWindow,
	selectTimelineWindow,
	type SessionTimelineBatch,
	type SessionTimelineBatchOptions,
	type SessionTimelineScope,
	type SessionTimelineStreamDeps,
	type SessionTimelineWindowOptions,
} from "./sessionTimelineLive";

type ReadBatch = NonNullable<SessionTimelineStreamDeps["readBatch"]>;
type ReadSettledCount = NonNullable<SessionTimelineStreamDeps["readSettledCount"]>;
type ReadInProgress = NonNullable<SessionTimelineStreamDeps["readInProgress"]>;
type ReadInProgressRevision = NonNullable<SessionTimelineStreamDeps["readInProgressRevision"]>;

const db = {} as NodePgDatabase<typeof schema>;

const scope: SessionTimelineScope = {
	groupKey: "s:session-1",
	includeAuxiliary: false,
	visibilityClause: sql`TRUE`,
	activeVisibilityClause: sql`TRUE`,
};

function rowPositionKey(row: Pick<SessionTimelineSourceRow, "startTime" | "request_id">): string {
	return `${new Date(row.startTime).toISOString()}|${row.request_id}`;
}

function sessionPositionKey(position: SessionPosition): string {
	return `${position.startTime.toISOString()}|${position.requestId}`;
}

function buildRow(overrides: Partial<SessionTimelineSourceRow> & { readonly request_id: string }): SessionTimelineSourceRow {
	const startTime = overrides.startTime ?? new Date("2026-01-01T00:00:00.000Z");
	return {
		call_type: "acompletion",
		api_key: "key-1",
		key_alias: "key-1-alias",
		spend: 0.01,
		total_tokens: 10,
		startTime: startTime,
		endTime: new Date(new Date(startTime).getTime() + 1_000),
		model: "gpt-test",
		status: "success",
		metadata_status: "success",
		error_information: null,
		request_payload: { body: { messages: [] } },
		response_payload: null,
		...overrides,
	};
}

function conversation(...contents: readonly string[]): unknown {
	return {
		body: {
			messages: contents.map((content, index) => ({
				role: index % 2 === 0 ? "user" : "assistant",
				content: content,
			})),
		},
	};
}

/** 注入确定的数据面，避免测试依赖数据库。 */
class FakeSessionStore {
	settled: SessionTimelineSourceRow[];
	active: SessionTimelineSourceRow[];
	activeRevision = "0";
	readonly batchReads: Array<string | null> = [];

	constructor(settled: SessionTimelineSourceRow[], active: SessionTimelineSourceRow[] = []) {
		this.settled = settled;
		this.active = active;
	}

	readonly readBatch: ReadBatch = async (_db, _scope, options: SessionTimelineBatchOptions): Promise<SessionTimelineBatch> => {
		const since = options.since ?? null;
		this.batchReads.push(since ? since.requestId : null);
		const before = options.before ?? null;
		const after = options.after ?? null;
		const forward = options.direction === "forward" || after !== null;
		let rows = since
			? this.settled.filter((row) => rowPositionKey(row) > sessionPositionKey(since))
			: before
				? this.settled.filter((row) => rowPositionKey(row) < sessionPositionKey(before))
				: after
					? this.settled.filter((row) => rowPositionKey(row) > sessionPositionKey(after))
					: [...this.settled];
		const limit = since ? null : (options.limit ?? null);
		let hasMore = false;
		if (limit !== null && rows.length > limit) {
			rows = forward ? rows.slice(0, limit) : rows.slice(rows.length - limit);
			hasMore = true;
		}
		const first = rows[0];
		const last = rows[rows.length - 1];
		return {
			rows: rows,
			position: last ? { startTime: new Date(last.startTime), requestId: last.request_id } : (since ?? before ?? after),
			oldest: first ? { startTime: new Date(first.startTime), requestId: first.request_id } : null,
			hasMore: hasMore,
			total: this.settled.length,
			seenMessageCount: options.seenMessageCount ?? 0,
		};
	};

	readonly readSettledCount: ReadSettledCount = async () => this.settled.length;
	readonly readInProgress: ReadInProgress = async () => [...this.active];
	readonly readInProgressRevision: ReadInProgressRevision = async () => this.activeRevision;
}

function createState(store: FakeSessionStore, window: SessionTimelineWindowOptions = {}) {
	return createSessionTimelineStreamState(
		db,
		scope,
		{
			readBatch: store.readBatch,
			readSettledCount: store.readSettledCount,
			readInProgress: store.readInProgress,
			readInProgressRevision: store.readInProgressRevision,
		},
		window,
	);
}

const settledRequest = buildRow({
	request_id: "req-settled",
	startTime: new Date("2026-01-01T00:00:00.000Z"),
	request_payload: conversation("first question"),
	response_payload: { choices: [{ message: { role: "assistant", content: "first answer" } }] },
});

/** 生成 n 条按开单时间递增的会话请求，用于窗口与翻页用例。 */
function turnRows(count: number): SessionTimelineSourceRow[] {
	return Array.from({ length: count }, (_unused, index) =>
		buildRow({
			request_id: `req-${index}`,
			startTime: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
			endTime: new Date(Date.UTC(2026, 0, 1, 0, 0, index) + 1_000),
			request_payload: conversation(`question ${index}`),
			response_payload: { choices: [{ message: { role: "assistant", content: `answer ${index}` } }] },
		}),
	);
}

const runningRequest = buildRow({
	request_id: "req-running",
	startTime: new Date("2026-01-01T00:00:10.000Z"),
	status: "in_progress",
	metadata_status: "in_progress",
	request_payload: conversation("first question", "first answer", "follow up"),
	response_payload: null,
});

describe("session timeline stream state", () => {
	it("keeps in-progress requests out of settled data and only adds their new messages", async () => {
		const store = new FakeSessionStore([settledRequest], [runningRequest]);
		const state = createState(store);

		const snapshot = await state.snapshot();

		expect(new Set(snapshot.data.map((event) => event.request_id))).toEqual(new Set(["req-settled"]));
		expect(snapshot.active_requests.map((group) => group.request_id)).toEqual(["req-running"]);
		const activeContents = snapshot.active_requests[0]!.events.map((event) => event.content);
		expect(activeContents).toContain("follow up");
		// 进行中请求的请求体包含完整历史，已经落库的消息不能重复出现。
		expect(activeContents).not.toContain("first question");
		expect(snapshot.summary.in_progress_request_count).toBe(1);
		expect(snapshot.summary.request_count).toBe(2);
	});

	it("进行中的请求展示最终上游消息里的私有工具调用与结果", async () => {
		const active = buildRow({
			request_id: "req-running",
			startTime: new Date("2026-01-01T00:00:10.000Z"),
			status: "in_progress",
			metadata_status: "in_progress",
			request_payload_upstream: true,
			request_payload: {
				messages: [
					{ role: "user", content: "first question" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_00_create",
								type: "function",
								function: { name: "litellm__image_create", arguments: '{"prompt":"一只金毛幼犬"}' },
							},
						],
					},
					{ role: "tool", tool_call_id: "call_00_create", content: "已生成图片" },
				],
			},
			response_payload: null,
		});
		const state = createState(new FakeSessionStore([settledRequest], [active]));

		const snapshot = await state.snapshot();
		const events = snapshot.active_requests[0]!.events;

		expect(events.map((event) => event.content)).toContain("已生成图片");
		expect(events.some((event) => event.private_tool_call)).toBe(false);
	});

	it("stays silent when neither settled nor in-progress rows changed", async () => {
		const store = new FakeSessionStore([settledRequest], [runningRequest]);
		const state = createState(store);

		await state.snapshot();

		expect(await state.refresh()).toBeNull();
	});

	it("moves a settled request from the overlay into settled events with the same ids", async () => {
		const store = new FakeSessionStore([settledRequest], [runningRequest]);
		const state = createState(store);
		const snapshot = await state.snapshot();
		const overlayIds = snapshot.active_requests[0]!.events.map((event) => event.id);

		store.active = [];
		store.activeRevision = "1";
		store.settled = [
			settledRequest,
			buildRow({
				request_id: "req-running",
				startTime: new Date("2026-01-01T00:00:10.000Z"),
				endTime: new Date("2026-01-01T00:00:20.000Z"),
				request_payload: conversation("first question", "first answer", "follow up"),
				response_payload: { choices: [{ message: { role: "assistant", content: "second answer" } }] },
			}),
		];

		const update = await state.refresh();

		expect(update).not.toBeNull();
		expect(update!.active_requests).toEqual([]);
		expect(update!.upsert.length).toBeGreaterThan(0);
		expect(update!.upsert.every((event) => event.request_id === "req-running")).toBe(true);
		const settledIds = new Set(update!.upsert.map((event) => event.id));
		// 结算不改变事件 id，前端按 id 渲染的列表因此不会闪断。
		for (const id of overlayIds) {
			expect(settledIds.has(id)).toBe(true);
		}
		expect(update!.summary.in_progress_request_count).toBe(0);
	});

	it("pushes only the overlay when an in-progress request records more output", async () => {
		const store = new FakeSessionStore([settledRequest], [runningRequest]);
		const state = createState(store);
		await state.snapshot();

		store.active = [
			buildRow({
				request_id: "req-running",
				startTime: new Date("2026-01-01T00:00:10.000Z"),
				status: "in_progress",
				metadata_status: "in_progress",
				request_payload: conversation("first question", "first answer", "follow up"),
				response_payload: {
					choices: [{ message: { role: "assistant", content: "streaming partial output" } }],
				},
			}),
		];
		store.activeRevision = "1";

		const update = await state.refresh();

		expect(update).not.toBeNull();
		expect(update!.upsert).toEqual([]);
		expect(update!.order).toBeUndefined();
		const contents = update!.active_requests[0]!.events.map((event) => event.content);
		expect(contents).toContain("streaming partial output");
		expect(update!.summary.in_progress_request_count).toBe(1);
	});

	it("进行中请求的正文只更新在内存里时也会推送", async () => {
		resetLiveResponseRegistry();
		const store = new FakeSessionStore([settledRequest], [runningRequest]);
		const state = createState(store);
		await state.snapshot();

		// 数据库指纹没变（updated_at 不会被内存推送推进），只有执行流发布了新正文。
		registerLiveResponse("req-running", () => ({
			response: { choices: [{ message: { role: "assistant", content: "memory only output" } }] },
			usage: { prompt_tokens: 3, completion_tokens: 9, total_tokens: 12 },
		}));
		publishLiveResponse("req-running", {
			response: { choices: [{ message: { role: "assistant", content: "memory only output" } }] },
			usage: { prompt_tokens: 3, completion_tokens: 9, total_tokens: 12 },
		});

		const update = await state.refresh();

		expect(update).not.toBeNull();
		const contents = update!.active_requests[0]!.events.map((event) => event.content);
		expect(contents).toContain("memory only output");
	});

	it("rebuilds from a full scan when a late request settles before the cursor", async () => {
		const first = buildRow({
			request_id: "req-first",
			startTime: new Date("2026-01-01T00:00:00.000Z"),
			request_payload: conversation("first question"),
			response_payload: { choices: [{ message: { role: "assistant", content: "first answer" } }] },
		});
		const last = buildRow({
			request_id: "req-last",
			startTime: new Date("2026-01-01T00:00:30.000Z"),
			request_payload: conversation("late question"),
			response_payload: { choices: [{ message: { role: "assistant", content: "late answer" } }] },
		});
		const store = new FakeSessionStore([first, last]);
		const state = createState(store);
		await state.snapshot();

		const late = buildRow({
			request_id: "req-late",
			startTime: new Date("2026-01-01T00:00:10.000Z"),
			request_payload: conversation("retried question"),
			response_payload: { choices: [{ message: { role: "assistant", content: "retried answer" } }] },
		});
		store.settled = [first, late, last];

		const update = await state.refresh();

		expect(update).not.toBeNull();
		// 先尝试游标增量，发现增量覆盖不全（总数变多但游标后没有行）后整段重读，
		// 否则游标之前的迟到请求会永远漏掉。
		expect(store.batchReads).toEqual([null, "req-last", null]);
		const order = update!.order ?? [];
		const requestOrder = order.map((id) => id.split(":")[0]).filter((requestId, index, all) => all.indexOf(requestId) === index);
		expect(requestOrder).toEqual(["req-first", "req-late", "req-last"]);
	});

	it("limits the snapshot to the newest window and hands back a cursor for older requests", async () => {
		const store = new FakeSessionStore(turnRows(4));
		const state = createState(store, { limit: 2 });

		const snapshot = await state.snapshot();

		const contents = snapshot.data.map((event) => event.content);
		expect(contents).toContain("question 2");
		expect(contents).toContain("question 3");
		expect(contents).not.toContain("question 0");
		expect(snapshot.window).toEqual({
			returned_requests: 2,
			total_requests: 4,
			has_more: true,
			before: expect.any(String),
			after: expect.any(String),
			limit: 2,
		});

		const olderState = createState(store, {
			limit: 2,
			before: parseSessionPosition(snapshot.window?.before, "before"),
		});
		const older = await olderState.snapshot();

		expect(older.data.map((event) => event.content)).toEqual(expect.arrayContaining(["question 0", "question 1"]));
		expect(older.data.map((event) => event.content)).not.toContain("question 3");
		expect(older.window).toEqual({
			returned_requests: 2,
			total_requests: 4,
			has_more: false,
			before: null,
			after: expect.any(String),
			limit: 2,
		});
	});

	it("starts from the earliest window and hands back a cursor for newer requests", async () => {
		const store = new FakeSessionStore(turnRows(4));
		const state = createState(store, { limit: 2, direction: "forward" });

		const snapshot = await state.snapshot();

		const contents = snapshot.data.map((event) => event.content);
		expect(contents).toContain("question 0");
		expect(contents).toContain("question 1");
		expect(contents).not.toContain("question 2");
		expect(snapshot.window).toEqual({
			returned_requests: 2,
			total_requests: 4,
			has_more: true,
			before: null,
			after: expect.any(String),
			limit: 2,
		});

		const newerState = createState(store, {
			limit: 2,
			direction: "forward",
			after: parseSessionPosition(snapshot.window?.after, "after"),
		});
		const newer = await newerState.snapshot();

		expect(newer.data.map((event) => event.content)).toEqual(expect.arrayContaining(["question 2", "question 3"]));
		expect(newer.data.map((event) => event.content)).not.toContain("question 0");
		expect(newer.window).toEqual({
			returned_requests: 2,
			total_requests: 4,
			has_more: false,
			before: null,
			after: expect.any(String),
			limit: 2,
		});
	});

	it("keeps appending only new settled rows after a windowed snapshot", async () => {
		const rows = turnRows(3);
		const store = new FakeSessionStore(rows);
		const state = createState(store, { limit: 2 });
		await state.snapshot();

		store.settled = [...rows, turnRows(4)[3]!];
		const update = await state.refresh();

		expect(update).not.toBeNull();
		expect(new Set(update!.upsert.map((event) => event.request_id))).toEqual(new Set(["req-3"]));
		expect(store.batchReads).toEqual([null, "req-2"]);
	});
});

describe("selectForwardTimelineWindow", () => {
	it("takes the earliest rows in ascending order and reports more newer rows", () => {
		const rows = [
			{ messages_bytes: 1024, name: "newest", request_id: "req-2", startTime: new Date("2026-01-01T00:00:02.000Z") },
			{ messages_bytes: 1024, name: "middle", request_id: "req-1", startTime: new Date("2026-01-01T00:00:01.000Z") },
			{ messages_bytes: 1024, name: "oldest", request_id: "req-0", startTime: new Date("2026-01-01T00:00:00.000Z") },
		];

		const window = selectForwardTimelineWindow(rows, 2, 1024 * 1024);

		expect(window.rows.map((row) => row.name)).toEqual(["oldest", "middle"]);
		expect(window.hasMore).toBe(true);
	});

	it("stops at the byte budget but always keeps the earliest row", () => {
		const rows = [
			{ messages_bytes: 70 * 1024 * 1024, name: "oldest", request_id: "req-0", startTime: new Date("2026-01-01T00:00:00.000Z") },
			{ messages_bytes: 70 * 1024 * 1024, name: "newer", request_id: "req-1", startTime: new Date("2026-01-01T00:00:01.000Z") },
		];

		const window = selectForwardTimelineWindow(rows, 50, 24 * 1024 * 1024);

		expect(window.rows.map((row) => row.name)).toEqual(["oldest"]);
		expect(window.hasMore).toBe(true);
	});
});

describe("selectTimelineWindow", () => {
	it("takes the newest rows in ascending order and reports the next older row as predecessor", () => {
		const rows = [
			{ messages_bytes: 1024, name: "newest", request_id: "req-2", startTime: new Date("2026-01-01T00:00:02.000Z") },
			{ messages_bytes: 1024, name: "middle", request_id: "req-1", startTime: new Date("2026-01-01T00:00:01.000Z") },
			{ messages_bytes: 1024, name: "oldest", request_id: "req-0", startTime: new Date("2026-01-01T00:00:00.000Z") },
		];

		const window = selectTimelineWindow(rows, 2, 1024 * 1024);

		// 返回顺序固定为位置升序，与读取顺序无关。
		expect(window.rows.map((row) => row.name)).toEqual(["middle", "newest"]);
		expect(window.hasMore).toBe(true);
		expect(window.predecessor?.name).toBe("oldest");
	});

	it("stops at the byte budget but always keeps the newest row", () => {
		const rows = [
			{ messages_bytes: 70 * 1024 * 1024, name: "newest", request_id: "req-9", startTime: new Date("2026-01-01T00:00:09.000Z") },
			{ messages_bytes: 70 * 1024 * 1024, name: "older", request_id: "req-8", startTime: new Date("2026-01-01T00:00:08.000Z") },
		];

		const window = selectTimelineWindow(rows, 50, 24 * 1024 * 1024);

		// 单行就超过预算时仍然返回最新一行，否则长会话会读不到任何内容。
		expect(window.rows.map((row) => row.name)).toEqual(["newest"]);
		expect(window.hasMore).toBe(true);
		expect(window.predecessor?.name).toBe("older");
	});

	it("returns every row when the session fits the budget", () => {
		const rows = [{ messages_bytes: 2048, name: "only", request_id: "req-0", startTime: new Date("2026-01-01T00:00:00.000Z") }];

		const window = selectTimelineWindow(rows, 50, 1024 * 1024);

		expect(window.rows).toEqual(rows);
		expect(window.hasMore).toBe(false);
		expect(window.predecessor).toBeNull();
	});
});

describe("compactSessionTimelinePayload", () => {
	const summary = {
		keys: [],
		request_count: 1,
		event_count: 1,
		total_spend: 0,
		total_tokens: 0,
		duration_seconds: 0,
		start_time: null,
		end_time: null,
		filtered_request_count: 0,
		in_progress_request_count: 0,
	};
	const item = (parts: SessionTimelinePart[]): SessionTimelineItem => ({
		id: "event-1",
		request_id: "request-1",
		role: "tool",
		label: "Tool result",
		timestamp: "2026-01-01T00:00:00Z",
		model: "gpt-test",
		content: "summary",
		parts,
	});

	it("省略工具结果里与结构化 parts 重复的原始 data", () => {
		const toolResult: SessionTimelinePart = {
			kind: "tool_result",
			label: "Tool result",
			text: "summary",
			data: { type: "image", source: { data: "a".repeat(1024) } },
			parts: [{ kind: "text", label: "Text", text: "nested" }],
		};
		const payload = compactSessionTimelinePayload({ data: [item([toolResult])], summary, active_requests: [] });
		const compacted = payload.data[0]?.parts?.[0];
		expect(compacted?.data).toBeUndefined();
		expect(compacted?.text).toBe("summary");
		expect(compacted?.parts).toEqual([{ kind: "text", label: "Text", text: "nested" }]);
	});

	it("内联图片超过阈值时换成占位，并保留结构化 parts 的其余内容", () => {
		const source = `data:image/png;base64,${"a".repeat(SESSION_TIMELINE_MAX_INLINE_IMAGE_CHARS + 1)}`;
		const image: SessionTimelinePart = {
			kind: "image",
			label: "Image",
			text: source,
			data: { src: source, mimeType: "image/png" },
		};
		const payload = compactSessionTimelinePayload({ data: [item([image])], summary, active_requests: [] });
		const compacted = payload.data[0]?.parts?.[0];
		expect(compacted?.text).toBe("图片过大，时间线中已省略原图。");
		expect(compacted?.data).toEqual({ truncated: true });
	});

	it("小图片和没有结构化 parts 的工具结果保持原引用", () => {
		const smallImage: SessionTimelinePart = {
			kind: "image",
			label: "Image",
			text: "data:image/png;base64,abc",
			data: { src: "data:image/png;base64,abc", mimeType: "image/png" },
		};
		const toolResult: SessionTimelinePart = { kind: "tool_result", label: "Tool result", text: "done", data: { ok: true } };
		const event = item([smallImage, toolResult]);
		const payload = compactSessionTimelinePayload({ data: [event], summary, active_requests: [] });
		expect(payload.data[0]).toBe(event);
	});
});
