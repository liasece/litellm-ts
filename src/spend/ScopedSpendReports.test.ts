import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { registerScopedSpendReports } from "./ScopedSpendReports";

function fixture(rows: unknown[] = [{ model: "model-a", total_spend: 1, total_tokens: 10, total_requests: 1 }]) {
	const limit = jest.fn(async () => rows);
	const where = jest.fn((_predicate: SQL) => ({ groupBy: () => ({ orderBy: () => ({ limit }) }) }));
	const select = jest.fn(() => ({ from: () => ({ where }) }));
	const app = express();
	app.use((req, _res, next) => {
		req.auth = { api_key: "synthetic", token: "own-key-hash", user_role: "internal_user", user_id: "user-a", team_id: "team-a" };
		next();
	});
	registerScopedSpendReports(app, { select } as never);
	return { app, where, select, limit };
}
it("constrains omitted key identity to the caller and combines date/model filters in the executed SQL", async () => {
	const { app, where, limit } = fixture();
	const result = await request(app)
		.get("/key/spend/report")
		.query({ model: "model-a", start_date: "2026-10-01", end_date: "2026-10-02" });
	expect(result.status).toBe(200);
	expect(result.body).toEqual([{ model: "model-a", total_spend: 1, total_tokens: 10, total_requests: 1 }]);
	const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
	expect(query.params).toContain("own-key-hash");
	expect(query.params).toContain("model-a");
	expect(query.params).toContain("2026-10-01T00:00:00.000Z");
	expect(query.params).toContain("2026-10-03T00:00:00.000Z");
	expect(limit).toHaveBeenCalledWith(1001);
});
it("rejects another caller identity or an unbounded date range before querying", async () => {
	const { app, select } = fixture();
	expect((await request(app).get("/key/spend/report").query({ api_key: "another-key" })).status).toBe(403);
	expect((await request(app).get("/team/spend/report").query({ team_id: "another-team" })).status).toBe(403);
	expect((await request(app).get("/user/spend/report").query({ start_date: "2024-01-01", end_date: "2026-10-01" })).status).toBe(400);
	expect(select).not.toHaveBeenCalled();
});
it("requires narrowing the query instead of silently truncating model aggregates", async () => {
	const { app } = fixture(Array.from({ length: 1001 }, (_, model) => ({ model: String(model) })));
	expect((await request(app).get("/key/spend/report")).status).toBe(400);
});
