import { ApiError } from "../core/api/ApiError";
import type { Router } from "express";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { resolveUsageScope, usageDateRange } from "./UsageQuery";

/**
 * @param router
 * @param db
 */
export function registerScopedSpendReports(router: Router, db: DrizzleDb): void {
	const definitions = [
		["key", "api_key", liteLLM_SpendLogs.api_key],
		["user", "user_id", liteLLM_SpendLogs.user],
		["team", "team_id", liteLLM_SpendLogs.team_id],
		["organization", "organization_id", liteLLM_SpendLogs.organization_id],
	] as const;
	for (const [scope, param, column] of definitions) {
		registerRoute(router, { method: "get", path: `/${scope}/spend/report` }, async (req) => {
			const range = usageDateRange(req.query);
			const requested = typeof req.query[param] === "string" ? req.query[param] : undefined;
			const id = resolveUsageScope(req.auth, scope, requested);
			const conditions: SQL[] = [gte(liteLLM_SpendLogs.startTime, range.start), lt(liteLLM_SpendLogs.startTime, range.end)];
			if (typeof req.query["model"] === "string") {
				conditions.push(eq(liteLLM_SpendLogs.model, req.query["model"]));
			}
			if (id !== undefined) {
				conditions.push(eq(column, id));
			}
			const rows = await db
				.select({
					model: liteLLM_SpendLogs.model,
					total_spend: sql<number>`SUM(${liteLLM_SpendLogs.spend})`,
					total_tokens: sql<number>`SUM(${liteLLM_SpendLogs.total_tokens})`.mapWith(Number),
					total_requests: sql<number>`COUNT(*)`.mapWith(Number),
				})
				.from(liteLLM_SpendLogs)
				.where(and(...conditions))
				.groupBy(liteLLM_SpendLogs.model)
				.orderBy(desc(sql`SUM(${liteLLM_SpendLogs.spend})`))
				.limit(1001);
			if (rows.length > 1000) {
				throw ApiError.badRequest("Too many models; narrow the date range or pass a model filter");
			}
			return rows;
		});
	}
}
