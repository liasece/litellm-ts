/**
 * 团队管理端点 — CRUD + 成员管理 + 模型管理
 *
 * 工厂函数：createTeamRoutes(router, db, authMiddleware)
 * 注册所有 /team/* 路由，针对 LiteLLM_TeamTable。
 */

import type { Router, Request, RequestHandler } from "express";
import { eq, and } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Management:Team");

/**
 * 创建团队管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createTeamRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
	function authed(handler: (req: Request) => unknown | Promise<unknown>): (req: Request) => unknown | Promise<unknown> {
		return async (req: Request) => {
			if (authMiddleware) {
				await new Promise<void>((resolve, reject) => {
					authMiddleware(req, {} as never, (err?: unknown) => {
						if (err) {
							reject(err);
						} else {
							resolve();
						}
					});
				});
			}
			return handler(req);
		};
	}

	// ─── POST /team/new ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/new" },
		authed(async (req) => {
			const {
				team_alias,
				organization_id,
				admins,
				members,
				metadata,
				models,
				max_budget,
				soft_budget,
				tpm_limit,
				rpm_limit,
				budget_duration,
				blocked,
			} = req.body ?? {};

			const result = await db
				.insert(LiteLLM_TeamTable)
				.values({
					teamAlias: team_alias ?? null,
					organizationId: organization_id ?? null,
					admins: admins ?? [],
					members: members ?? [],
					metadata: metadata ?? {},
					models: models ?? [],
					maxBudget: max_budget ?? null,
					softBudget: soft_budget ?? null,
					tpmLimit: tpm_limit ?? null,
					rpmLimit: rpm_limit ?? null,
					budgetDuration: budget_duration ?? null,
					blocked: blocked ?? false,
				})
				.returning({ teamId: LiteLLM_TeamTable.teamId });

			const teamId = result[0]!.teamId;
			logger.info(`团队已创建: ${team_alias ?? teamId}`);

			return { success: true, team_id: teamId };
		}),
	);

	// ─── POST /team/update ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/update" },
		authed(async (req) => {
			const { team_id, ...updates } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const existing = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			const updateFields: Record<string, unknown> = {};
			if (updates.team_alias !== undefined) {
				updateFields.teamAlias = updates.team_alias;
			}
			if (updates.organization_id !== undefined) {
				updateFields.organizationId = updates.organization_id;
			}
			if (updates.admins !== undefined) {
				updateFields.admins = updates.admins;
			}
			if (updates.members !== undefined) {
				updateFields.members = updates.members;
			}
			if (updates.metadata !== undefined) {
				updateFields.metadata = updates.metadata;
			}
			if (updates.models !== undefined) {
				updateFields.models = updates.models;
			}
			if (updates.max_budget !== undefined) {
				updateFields.maxBudget = updates.max_budget;
			}
			if (updates.soft_budget !== undefined) {
				updateFields.softBudget = updates.soft_budget;
			}
			if (updates.tpm_limit !== undefined) {
				updateFields.tpmLimit = updates.tpm_limit;
			}
			if (updates.rpm_limit !== undefined) {
				updateFields.rpmLimit = updates.rpm_limit;
			}
			if (updates.budget_duration !== undefined) {
				updateFields.budgetDuration = updates.budget_duration;
			}

			await db
				.update(LiteLLM_TeamTable)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			logger.info(`团队已更新: ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/delete ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/delete" },
		authed(async (req) => {
			const { team_id } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const result = await db.delete(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			logger.info(`团队已删除: ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/block ──────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/block" },
		authed(async (req) => {
			const { team_id } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const result = await db
				.update(LiteLLM_TeamTable)
				.set({ blocked: true, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			logger.info(`团队已阻止: ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/unblock ────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/unblock" },
		authed(async (req) => {
			const { team_id } = req.body ?? {};

			if (!team_id) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const result = await db
				.update(LiteLLM_TeamTable)
				.set({ blocked: false, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, team_id));

			if (result.rowCount === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			logger.info(`团队已解封: ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/member/add ─────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/member/add" },
		authed(async (req) => {
			const { team_id, user_id, budget_id } = req.body ?? {};

			if (!team_id || !user_id) {
				throw ApiError.badRequest("必须提供 team_id 和 user_id");
			}

			const team = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (team.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			// 写入团队成员表
			await db
				.insert(LiteLLM_TeamMembership)
				.values({ userId: user_id, teamId: team_id, budgetId: budget_id ?? null })
				.onConflictDoNothing();

			logger.info(`成员已加入团队: ${user_id} -> ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/member/delete ──────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/member/delete" },
		authed(async (req) => {
			const { team_id, user_id } = req.body ?? {};

			if (!team_id || !user_id) {
				throw ApiError.badRequest("必须提供 team_id 和 user_id");
			}

			const result = await db
				.delete(LiteLLM_TeamMembership)
				.where(and(eq(LiteLLM_TeamMembership.teamId, team_id), eq(LiteLLM_TeamMembership.userId, user_id)));

			if (result.rowCount === 0) {
				throw ApiError.notFound("团队成员关系不存在");
			}

			logger.info(`成员已从团队移除: ${user_id} -> ${team_id}`);

			return { success: true };
		}),
	);

	// ─── GET /team/info ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/team/info" },
		authed(async (req) => {
			const teamId = (req.query.team_id as string) ?? req.body?.team_id;

			if (!teamId) {
				throw ApiError.badRequest("必须提供 team_id");
			}

			const rows = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, teamId)).limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound(`团队不存在: ${teamId}`);
			}

			return { success: true, data: rows[0] };
		}),
	);

	// ─── GET /team/list ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/team/list" },
		authed(async () => {
			const rows = await db.select().from(LiteLLM_TeamTable);
			return { success: true, data: rows };
		}),
	);

	// ─── POST /team/model/add ──────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/model/add" },
		authed(async (req) => {
			const { team_id, model } = req.body ?? {};

			if (!team_id || !model) {
				throw ApiError.badRequest("必须提供 team_id 和 model");
			}

			const team = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (team.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			const currentModels = team[0]!.models ?? [];
			if (!currentModels.includes(model)) {
				currentModels.push(model);
				await db
					.update(LiteLLM_TeamTable)
					.set({ models: currentModels, updatedAt: new Date() })
					.where(eq(LiteLLM_TeamTable.teamId, team_id));
			}

			logger.info(`模型已添加到团队: ${model} -> ${team_id}`);

			return { success: true };
		}),
	);

	// ─── POST /team/model/delete ───────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/team/model/delete" },
		authed(async (req) => {
			const { team_id, model } = req.body ?? {};

			if (!team_id || !model) {
				throw ApiError.badRequest("必须提供 team_id 和 model");
			}

			const team = await db.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, team_id)).limit(1);
			if (team.length === 0) {
				throw ApiError.notFound(`团队不存在: ${team_id}`);
			}

			const currentModels = team[0]!.models ?? [];
			const filtered = currentModels.filter((m: string) => m !== model);

			if (filtered.length !== currentModels.length) {
				await db
					.update(LiteLLM_TeamTable)
					.set({ models: filtered, updatedAt: new Date() })
					.where(eq(LiteLLM_TeamTable.teamId, team_id));
			}

			logger.info(`模型已从团队移除: ${model} -> ${team_id}`);

			return { success: true };
		}),
	);
}
