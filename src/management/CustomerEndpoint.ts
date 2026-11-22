/**
 * 端用户管理端点 — CRUD + 阻止/解封
 *
 * 工厂函数：createCustomerRoutes(router, db, authMiddleware)
 * 注册所有 /customer/* 路由，针对 LiteLLM_EndUserTable。
 */

import type { Router, Request, RequestHandler } from "express";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { budgetRepositoryFor } from "../repositories/BudgetRepository";
import { endUserRepositoryFor } from "../repositories/EndUserRepository";
import { objectPermissionRepositoryFor } from "../repositories/ObjectPermissionRepository";
import { createModuleLogger } from "../core/utils/logger";
import { pythonListRepr, toPythonEndUserWriteRow, toPythonObjectPermission } from "./pythonRowSerializers";
import type { EndUserRow, EndUserUpdateValues } from "../repositories/EndUserRepository";
import type { ObjectPermissionRow } from "../repositories/ObjectPermissionRepository";

const logger = createModuleLogger("Management:Customer");

/** `/customer/list?size=` 的上限：只服务于下拉候选，不需要更大的页。 */
const END_USER_LIST_MAX_SIZE = 200;

/**
 * 解析 `/customer/list` 的可选 `size`；缺省或非法时返回 undefined（表示不截断）。
 * @param value - query 里的原始值
 */
function endUserListLimit(value: unknown): number | undefined {
	const raw = typeof value === "string" ? value.trim() : "";
	if (!/^\d+$/.test(raw)) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return parsed > 0 ? Math.min(parsed, END_USER_LIST_MAX_SIZE) : undefined;
}

/**
 * 按 budget_id 加载关联预算行；budgetId 为 null 或行不存在时返回 null。
 * @param db - Drizzle 数据库实例
 * @param budgetId - 端用户行上的 budget_id
 */
async function loadBudgetRow(db: DrizzleDb, budgetId: string | null): Promise<Record<string, unknown> | null> {
	if (budgetId === null) {
		return null;
	}
	const budgetRow = await budgetRepositoryFor(db).findById(budgetId);
	return budgetRow === null ? null : (budgetRow as unknown as Record<string, unknown>);
}

/**
 * 端用户行 → Python /customer/list 实测响应字段（snake_case）。
 * Python 端 find_many(include={litellm_budget_table, object_permission})，
 * 无关联时对应字段为 null。协议源码：litellm/proxy/management_endpoints/customer_endpoints.py list_end_user。
 * @param row
 * @param budgetsById
 * @param permissionsById
 */
function toPythonEndUserRow(
	row: EndUserRow,
	budgetsById: ReadonlyMap<string, Record<string, unknown>>,
	permissionsById: ReadonlyMap<string, ObjectPermissionRow>,
): Record<string, unknown> {
	const budget = row.budgetId !== null ? (budgetsById.get(row.budgetId) ?? null) : null;
	const permission = row.objectPermissionId !== null ? (permissionsById.get(row.objectPermissionId) ?? null) : null;
	return {
		user_id: row.userId,
		blocked: row.blocked ?? false,
		alias: row.alias,
		spend: row.spend ?? 0,
		allowed_model_region: row.allowedModelRegion,
		default_model: row.defaultModel,
		litellm_budget_table: budget,
		object_permission_id: row.objectPermissionId,
		object_permission: permission !== null ? toPythonObjectPermission(permission) : null,
	};
}

/**
 * 创建端用户管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authMiddleware - 认证中间件（null 表示不要求认证）
 */
export function createCustomerRoutes(router: Router, db: DrizzleDb, authMiddleware: RequestHandler | null): void {
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

	// ─── POST /customer/new ─────────────────────────────────────
	// 响应对齐 Python new_end_user 实测：完整端用户对象（10 键，无 success 包装）。
	registerRoute(
		router,
		{ method: "post", path: "/customer/new" },
		authed(async (req) => {
			const { user_id, alias, allowed_model_region, default_model, budget_id, blocked } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const endUserRepository = endUserRepositoryFor(db);

			// 检查重复
			const existing = await endUserRepository.findById(user_id);

			if (existing !== null) {
				throw ApiError.conflict(`端用户已存在: ${user_id}`);
			}

			const row = await endUserRepository.create({
				userId: user_id,
				alias: alias ?? null,
				allowedModelRegion: allowed_model_region ?? null,
				defaultModel: default_model ?? null,
				budgetId: budget_id ?? null,
				blocked: blocked ?? false,
			});

			logger.info(`端用户已创建: ${user_id}`);

			const budgetRow = await loadBudgetRow(db, row.budgetId);
			return toPythonEndUserWriteRow(row, { budgetRow: budgetRow });
		}),
	);

	// ─── POST /customer/update ──────────────────────────────────
	// 响应对齐 Python update_end_user 实测：更新后完整端用户对象（10 键）。
	registerRoute(
		router,
		{ method: "post", path: "/customer/update" },
		authed(async (req) => {
			const { user_id, ...updates } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const endUserRepository = endUserRepositoryFor(db);
			const existing = await endUserRepository.findById(user_id);

			if (existing === null) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			const updateFields: EndUserUpdateValues = {};
			if (updates.alias !== undefined) {
				updateFields.alias = updates.alias;
			}
			if (updates.allowed_model_region !== undefined) {
				updateFields.allowedModelRegion = updates.allowed_model_region;
			}
			if (updates.default_model !== undefined) {
				updateFields.defaultModel = updates.default_model;
			}
			if (updates.budget_id !== undefined) {
				updateFields.budgetId = updates.budget_id;
			}

			const updated = await endUserRepository.updateById(user_id, updateFields);
			if (updated === null) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			logger.info(`端用户已更新: ${user_id}`);

			const budgetRow = await loadBudgetRow(db, updated.budgetId);
			return toPythonEndUserWriteRow(updated, { budgetRow: budgetRow });
		}),
	);

	// ─── POST /customer/delete ──────────────────────────────────
	// 对齐 Python delete_end_user：请求 { user_ids: [...] }，校验全部存在后删除，
	// 响应 { deleted_customers: N, message: "Successfully deleted customers with ids: ['a']" }。
	// 协议源码：litellm/proxy/management_endpoints/customer_endpoints.py delete_end_user
	registerRoute(
		router,
		{ method: "post", path: "/customer/delete" },
		authed(async (req) => {
			const body = (req.body ?? {}) as { user_ids?: unknown };
			const userIds = Array.isArray(body.user_ids)
				? body.user_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
				: [];

			if (userIds.length === 0) {
				throw ApiError.badRequest(`user_id is required, passed user_id = ${body.user_ids}`);
			}

			// Python: 任一不存在即 404（type=not_found, param=user_ids）
			const endUserRepository = endUserRepositoryFor(db);
			const existingRows = await endUserRepository.listByIds(userIds);
			const existingIds = new Set(existingRows.map((row) => row.userId));
			const missingIds = userIds.filter((id) => !existingIds.has(id));
			if (missingIds.length > 0) {
				throw new ApiError(
					HTTP_STATUS.NOT_FOUND,
					`End User Id(s)=${missingIds.join(", ")} do not exist in db`,
					"not_found",
					"user_ids",
				);
			}

			const deletedCount = await endUserRepository.deleteByIds(userIds);

			logger.info(`端用户已删除: count=${deletedCount}`);

			return {
				deleted_customers: deletedCount,
				message: `Successfully deleted customers with ids: ${pythonListRepr(userIds)}`,
			};
		}),
	);

	// ─── POST /customer/block ───────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/customer/block" },
		authed(async (req) => {
			const { user_id } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const affected = await endUserRepositoryFor(db).setBlocked(user_id, true);

			if (affected === 0) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			logger.info(`端用户已阻止: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── POST /customer/unblock ─────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/customer/unblock" },
		authed(async (req) => {
			const { user_id } = req.body ?? {};

			if (!user_id) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const affected = await endUserRepositoryFor(db).setBlocked(user_id, false);

			if (affected === 0) {
				throw ApiError.notFound(`端用户不存在: ${user_id}`);
			}

			logger.info(`端用户已解封: ${user_id}`);

			return { success: true };
		}),
	);

	// ─── GET /customer/info ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/customer/info" },
		authed(async (req) => {
			const userId = (req.query.user_id as string) ?? req.body?.user_id;

			if (!userId) {
				throw ApiError.badRequest("必须提供 user_id");
			}

			const row = await endUserRepositoryFor(db).findById(userId);

			if (row === null) {
				throw ApiError.notFound(`端用户不存在: ${userId}`);
			}

			return { success: true, data: row };
		}),
	);

	// ─── GET /customer/list ─────────────────────────────────────
	// Python 实测：返回裸数组（无 {success,data} 包装），字段 snake_case。
	// `search` / `size` 是可选参数：WebUI 的 Logs 页 End User 表头过滤器只在下拉里展示
	// 少量候选，端用户表到数万行后全量下发（实测 22 MB）会让每次输入都要重下一遍。
	// 缺省两个参数时仍返回完整数组，保持与 Python 一致的协议行为。
	registerRoute(
		router,
		{ method: "get", path: "/customer/list" },
		authed(async (req) => {
			const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
			const size = endUserListLimit(req.query.size);
			const [rows, budgets, permissions] = await Promise.all([
				endUserRepositoryFor(db).list({ search: search, limit: size }),
				budgetRepositoryFor(db).listAll(),
				objectPermissionRepositoryFor(db).listAll(),
			]);
			const budgetsById = new Map<string, Record<string, unknown>>(budgets.map((row) => [row.budget_id, row]));
			const permissionsById = new Map<string, ObjectPermissionRow>(permissions.map((row) => [row.objectPermissionId, row]));
			return rows.map((row) => toPythonEndUserRow(row, budgetsById, permissionsById));
		}),
	);
}
