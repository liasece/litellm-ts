import { ApiError } from "../core/api/ApiError";
import type { Router } from "express";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { spendAggregationRepositoryFor, type SpendReportDimension } from "../repositories/SpendAggregationRepository";
import { resolveUsageScope, usageDateRange } from "./UsageQuery";

/**
 * 按 key / user / team / organization 维度注册区间花费报表端点。
 *
 * 四个维度共用同一条聚合 SQL，差异只有「用哪一列过滤」：维度到列的映射由仓储拥有，
 * 端点只负责解析区间、鉴权范围与模型过滤，再决定是否报「模型太多」。
 * @param router - 已挂载鉴权的 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerScopedSpendReports(router: Router, db: DrizzleDb): void {
	const definitions = [
		["key", "api_key"],
		["user", "user_id"],
		["team", "team_id"],
		["organization", "organization_id"],
	] as const;
	for (const [scope, param] of definitions) {
		registerRoute(router, { method: "get", path: `/${scope}/spend/report` }, async (req) => {
			const range = usageDateRange(req.query);
			const requested = typeof req.query[param] === "string" ? req.query[param] : undefined;
			const id = resolveUsageScope(req.auth, scope, requested);
			const model = typeof req.query["model"] === "string" ? req.query["model"] : undefined;
			const dimension: SpendReportDimension = scope;
			// 多取一行用于判「是否超过上限」：直接 LIMIT 1000 会静默截断模型列表，
			// 调用方看到的是不完整的报表却拿不到任何提示。
			const rows = await spendAggregationRepositoryFor(db).scopedSpendReport(dimension, id, range.start, range.end, 1001, model);
			if (rows.length > 1000) {
				throw ApiError.badRequest("Too many models; narrow the date range or pass a model filter");
			}
			return rows;
		});
	}
}
