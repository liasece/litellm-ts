import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { spendLogStatusSql } from "./spendLogStatus";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithPostgres("spend log effective status PostgreSQL contract", () => {
	test("aborted filtering and counts recover only historical client cancellations and preserve spend", async () => {
		const pool = new Pool({
			connectionString: process.env.TEST_DATABASE_URL,
			options: "-c default_transaction_read_only=on",
			connectionTimeoutMillis: 5000,
			statement_timeout: 10000,
		});
		const clientError = { error_information: { error_type: "AbortError", error_message: "client aborted" } };
		const effectiveStatus = spendLogStatusSql(sql`status`, sql`metadata`);
		const query = new PgDialect().sqlToQuery(sql`
			WITH samples(request_id, status, metadata, spend) AS (VALUES
				('legacy', 'failure', ${JSON.stringify(clientError)}::jsonb, 1.25),
				('provider', 'failure', ${JSON.stringify({ error_information: { error_type: "AbortError", error_message: "provider timeout" } })}::jsonb, 0),
				('explicit-failure', 'failure', ${JSON.stringify({ ...clientError, termination_reason: "request_failed" })}::jsonb, 0),
				('restart', 'aborted', '{}'::jsonb, 0),
				('success', 'success', ${JSON.stringify(clientError)}::jsonb, 2)
			)
			SELECT request_id, ${effectiveStatus} AS status, COUNT(*) OVER()::int AS total, spend::float AS spend
			FROM samples WHERE ${effectiveStatus} = 'aborted' ORDER BY request_id
		`);
		try {
			const result = await pool.query(query.sql, query.params);
			expect(result.rows).toEqual([
				{ request_id: "legacy", status: "aborted", total: 2, spend: 1.25 },
				{ request_id: "restart", status: "aborted", total: 2, spend: 0 },
			]);
		} finally {
			await pool.end();
		}
	});
});
