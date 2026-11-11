import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { SessionTimelineBuilder } from "./sessionTimeline";
import { readSessionTimelineBatch, type SessionTimelineScope } from "./sessionTimelineLive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * 时间线请求消息优先取自最终上游请求。
 *
 * 这里用真实 PostgreSQL 覆盖两件事：上游引用列表按选中序号从块表还原；上游引用写成
 * `"$messages"` 时必须回落到列根引用，而不是把哨兵值当 JSON 文本解析。后者是只在真实
 * 数据库类型解析下才会暴露的回归，mock 查询无法覆盖。
 */
describeWithDatabase("Session timeline upstream request PostgreSQL integration", () => {
	let pool: Pool;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const testSchema = `litellm_timeline_test_${process.pid}_${Date.now()}`;
	const scope: SessionTimelineScope = {
		groupKey: "s:test-session",
		includeAuxiliary: false,
		visibilityClause: sql`TRUE`,
		activeVisibilityClause: sql`TRUE`,
	};

	beforeAll(async () => {
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${testSchema}` });
		await pool.query(`CREATE SCHEMA "${testSchema}"`);
		db = drizzle(pool, { schema: schema });
		await db.execute(sql`CREATE TABLE "LiteLLM_SpendLogs" (
			request_id text PRIMARY KEY,
			call_type text NOT NULL,
			api_key text,
			spend double precision,
			total_tokens integer,
			"startTime" timestamp NOT NULL,
			"endTime" timestamp NOT NULL,
			model text,
			model_id text,
			model_group text,
			status text,
			metadata jsonb,
			messages jsonb,
			response jsonb,
			proxy_server_request jsonb,
			session_group_key text
		)`);
		await db.execute(sql`CREATE TABLE "LiteLLM_SpendLogBlocks" (
			block_id text PRIMARY KEY,
			payload jsonb NOT NULL,
			byte_size integer NOT NULL,
			first_seen timestamp DEFAULT now() NOT NULL
		)`);
	});

	afterAll(async () => {
		if (pool) {
			await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
			await pool.end();
		}
	});

	it("按上游引用还原请求消息，并兼容 `$messages` 哨兵", async () => {
		await db.execute(sql`
			INSERT INTO "LiteLLM_SpendLogBlocks" (block_id, payload, byte_size) VALUES
				('b1', ${JSON.stringify({ role: "user", content: "hello" })}::jsonb, 10),
				('b2', ${JSON.stringify({ role: "assistant", content: "hi" })}::jsonb, 10),
				('b3', ${JSON.stringify({ role: "user", content: "upstream only" })}::jsonb, 10),
				('b4', ${JSON.stringify({ role: "tool", tool_call_id: "call_1", content: "tool result" })}::jsonb, 10)
		`);
		await db.execute(sql`
			INSERT INTO "LiteLLM_SpendLogs"
				(request_id, call_type, "startTime", "endTime", model, status, metadata, messages, response, proxy_server_request, session_group_key)
			VALUES
				(
					'req-upstream-refs',
					'completion',
					'2026-01-01T00:00:01Z',
					'2026-01-01T00:00:01.500Z',
					'gpt-test',
					'success',
					'{"status":"success"}'::jsonb,
					'{"_litellm_ref_messages":["b1","b2"]}'::jsonb,
					NULL,
					'{"body":{"messages":[{"role":"user","content":"hello"}]},"upstream_request":{"body":{"_litellm_ref_messages":["b1","b2","b3","b4"]}}}'::jsonb,
					's:test-session'
				),
				(
					'req-upstream-sentinel',
					'completion',
					'2026-01-01T00:00:02Z',
					'2026-01-01T00:00:02.500Z',
					'gpt-test',
					'success',
					'{"status":"success"}'::jsonb,
					'{"_litellm_ref_messages":["b1","b2"]}'::jsonb,
					NULL,
					'{"body":{},"upstream_request":{"body":{"_litellm_ref_messages":"$messages"}}}'::jsonb,
					's:test-session'
				)
		`);

		const batch = await readSessionTimelineBatch(db, scope, {
			since: { startTime: new Date("2026-01-01T00:00:00Z"), requestId: "before" },
			seenMessageCount: 0,
			limit: null,
		});

		expect(batch.rows).toHaveLength(2);
		const firstPayload = batch.rows[0]?.request_payload as {
			messages?: Array<{ role: string; content: string }>;
		};
		expect(firstPayload.messages?.map((message) => message.content)).toEqual(["hello", "hi", "upstream only", "tool result"]);
		expect(batch.rows[0]?.request_payload_upstream).toBe(true);

		const secondPayload = batch.rows[1]?.request_payload as {
			messages?: Array<{ role: string; content: string }>;
		};
		expect(secondPayload.messages?.map((message) => message.content)).toEqual(["hello", "hi"]);
		expect(batch.rows[1]?.request_payload_upstream).toBe(true);

		const builder = new SessionTimelineBuilder();
		for (const row of batch.rows) {
			builder.add(row);
		}
		const contents = builder.build().data.map((item) => item.content);
		expect(contents.filter((content) => content === "upstream only")).toHaveLength(1);
		expect(contents).toContain("tool result");
		expect(builder.build().data.some((item) => item.private_tool_call)).toBe(false);
	});

	it("最早优先从会话开头切窗口，并用 after 游标向后翻页", async () => {
		await db.execute(sql`
			INSERT INTO "LiteLLM_SpendLogs"
				(request_id, call_type, "startTime", "endTime", model, status, metadata, messages, response, proxy_server_request, session_group_key)
			SELECT
				'req-forward-' || i,
				'completion',
				'2026-01-01T00:02:00'::timestamp + (i || ' seconds')::interval,
				'2026-01-01T00:02:00'::timestamp + (i || ' seconds')::interval + interval '500 milliseconds',
				'gpt-test',
				'success',
				'{"status":"success"}'::jsonb,
				jsonb_build_object(
					'messages',
					(
						SELECT jsonb_agg(jsonb_build_object('role', 'user', 'content', 'f' || j) ORDER BY j)
						FROM generate_series(0, i * 2) AS j
					)
				),
				NULL,
				NULL,
				's:forward-session'
			FROM generate_series(0, 4) AS i
		`);

		const sessionScope = { ...scope, groupKey: "s:forward-session" };
		const first = await readSessionTimelineBatch(db, sessionScope, { direction: "forward", limit: 2 });
		expect(first.rows.map((row) => row.request_id)).toEqual(["req-forward-0", "req-forward-1"]);
		expect(first.hasMore).toBe(true);
		expect(first.total).toBe(5);
		expect(first.oldest?.requestId).toBe("req-forward-0");
		expect(first.position?.requestId).toBe("req-forward-1");

		const second = await readSessionTimelineBatch(db, sessionScope, {
			direction: "forward",
			after: first.position,
			limit: 2,
		});
		expect(second.rows.map((row) => row.request_id)).toEqual(["req-forward-2", "req-forward-3"]);
		expect(second.hasMore).toBe(true);
		expect(second.position?.requestId).toBe("req-forward-3");

		const third = await readSessionTimelineBatch(db, sessionScope, {
			direction: "forward",
			after: second.position,
			limit: 2,
		});
		expect(third.rows.map((row) => row.request_id)).toEqual(["req-forward-4"]);
		expect(third.hasMore).toBe(false);
	});

	it("只按规划出的尾部序号还原消息，保持原顺序", async () => {
		await db.execute(sql`
			INSERT INTO "LiteLLM_SpendLogBlocks" (block_id, payload, byte_size)
			SELECT 'p' || i, jsonb_build_object('role', 'user', 'content', 'm' || i), 10
			FROM generate_series(0, 59) AS i
		`);
		await db.execute(sql`
			INSERT INTO "LiteLLM_SpendLogs"
				(request_id, call_type, "startTime", "endTime", model, status, metadata, messages, response, proxy_server_request, session_group_key)
			VALUES (
				'req-partial-refs',
				'completion',
				'2026-01-01T00:01:00Z',
				'2026-01-01T00:01:00.500Z',
				'gpt-test',
				'success',
				'{"status":"success"}'::jsonb,
				jsonb_build_object(
					'_litellm_ref_messages',
					(SELECT jsonb_agg('p' || i ORDER BY i) FROM generate_series(0, 59) AS i)
				),
				NULL,
				jsonb_build_object(
					'body', '{}'::jsonb,
					'upstream_request', jsonb_build_object(
						'body', jsonb_build_object(
							'_litellm_ref_messages',
							(SELECT jsonb_agg('p' || i ORDER BY i) FROM generate_series(0, 59) AS i)
						)
					)
				),
				's:partial-session'
			)
		`);

		const batch = await readSessionTimelineBatch(
			db,
			{ ...scope, groupKey: "s:partial-session" },
			{ since: { startTime: new Date("2026-01-01T00:01:00Z"), requestId: "before" }, seenMessageCount: 0, limit: null },
		);

		expect(batch.rows).toHaveLength(1);
		const payload = batch.rows[0]?.request_payload as { messages?: Array<{ content: string }> };
		expect(payload.messages?.map((message) => message.content)).toEqual(Array.from({ length: 40 }, (_, index) => `m${index + 20}`));
		expect(batch.rows[0]?.request_payload_upstream).toBe(true);
	});
});
