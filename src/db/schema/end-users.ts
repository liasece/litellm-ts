/**
 * LiteLLM_EndUserTable — end users (consumers of the API)
 * Prisma model: LiteLLM_EndUserTable (natural key PK)
 */

import { doublePrecision, pgTable, text, boolean, jsonb } from "drizzle-orm/pg-core";

export const LiteLLM_EndUserTable = pgTable("LiteLLM_EndUserTable", {
	userId: text("user_id").notNull().primaryKey(),
	alias: text("alias"),
	spend: doublePrecision("spend").default(0.0).notNull(),
	allowedModelRegion: text("allowed_model_region"),
	defaultModel: text("default_model"),
	budgetId: text("budget_id"),
	objectPermissionId: text("object_permission_id"),
	blocked: boolean("blocked").default(false).notNull(),
	/** PY: 端用户最大预算（auth_checks.checkEndUserBudget） */
	maxBudget: doublePrecision("max_budget"),
	/** PY: 端用户软预算（auth_checks.checkEndUserBudget 仅警告） */
	softBudget: doublePrecision("soft_budget"),
	/** PY: 端用户元数据 */
	metadata: jsonb("metadata").default("{}"),
	/** PY: 端用户允许的路由列表 */
	allowedRoutes: text("allowed_routes").array(),
});
