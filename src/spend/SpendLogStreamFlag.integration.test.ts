import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { streamRequestedSql } from "./spendLogProjections";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

/**
 * 日志行的流式标记必须由请求体决定，而不是靠两个时间戳是否相等去猜。
 *
 * 这里用真实 PostgreSQL 覆盖投影表达式的三态：客户端省略 `stream` 是非流式（`false`），
 * 显式 `stream: true` 是流式，请求体没有落库时保持未知（`NULL`）。`jsonb` 缺键、`->>` 取
 * 文本、`jsonb_typeof(NULL)` 的解析差异只在真实数据库里才会暴露；Dashboard 用这个标记
 * 决定 TTFT 显示 `-` 还是数值，mock 查询无法覆盖。
 */
describeWithDatabase("Spend log stream flag PostgreSQL projection", () => {
	let pool: Pool;
	const testSchema = `litellm_stream_flag_test_${process.pid}_${Date.now()}`;

	beforeAll(async () => {
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${testSchema}` });
		await pool.query(`CREATE SCHEMA "${testSchema}"`);
		await pool.query(`CREATE TABLE "LiteLLM_SpendLogs" (request_id text PRIMARY KEY, proxy_server_request jsonb)`);
		await pool.query(`INSERT INTO "LiteLLM_SpendLogs" (request_id, proxy_server_request) VALUES
			('stream', '{"body":{"stream":true}}'),
			('non-stream', '{"body":{"model":"x"}}'),
			('explicit-false', '{"body":{"stream":false}}'),
			('no-body', '{}'),
			('null-body', NULL)`);
	});

	afterAll(async () => {
		await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
		await pool.end();
	});

	it("marks a request body without stream as non-streaming and leaves a missing body unknown", async () => {
		const db = drizzle(pool, { schema });
		const rows = await db
			.select({
				request_id: liteLLM_SpendLogs.request_id,
				stream: streamRequestedSql(liteLLM_SpendLogs.proxy_server_request),
			})
			.from(liteLLM_SpendLogs)
			.orderBy(liteLLM_SpendLogs.request_id);

		expect(rows).toEqual([
			{ request_id: "explicit-false", stream: false },
			{ request_id: "no-body", stream: null },
			{ request_id: "non-stream", stream: false },
			{ request_id: "null-body", stream: null },
			{ request_id: "stream", stream: true },
		]);
	});
});
