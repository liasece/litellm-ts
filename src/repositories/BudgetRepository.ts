/**
 * 预算仓储 — `LiteLLM_BudgetTable` 的唯一访问点。
 *
 * 预算行被用户/团队/组织/端用户/项目共用，鉴权链每次预算判断都要读，所以按
 * `budget_id` 进入按键缓存：键走 `authRepositoryCache` 的 `authCacheKey.budget`，
 * 与 `invalidateAuthCacheForSpendSubjects` 清的是同一个实例，结算后不会读到旧 spend。
 *
 * 预算行同时是「先建预算、再建实体」的引用目标，因此 `create` 需要把新 id 返回给
 * 调用方拼实体行；返回后写穿缓存，紧接着的实体校验不会再查一次库。
 */

import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { BaseRepository } from "../core/db/BaseRepository";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";
import { authCacheKey, authRepositoryCache } from "../auth/AuthRepositoryCache";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_BudgetTable` 行。 */
export type BudgetRow = typeof LiteLLM_BudgetTable.$inferSelect;
/** 新建预算行时可写入的列。 */
export type BudgetInsertValues = typeof LiteLLM_BudgetTable.$inferInsert;
/** 更新预算行时可修改的列（缺省列不参与 UPDATE）。 */
export type BudgetUpdateValues = Partial<typeof LiteLLM_BudgetTable.$inferInsert>;
/** 事务句柄；跨仓储写入时由调用方传入。 */
export type BudgetTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * 取得与数据库连接绑定的预算仓库；缓存是 `authRepositoryCache` 单例，与连接无关。
 * @param db - Drizzle 数据库实例
 */
export const budgetRepositoryFor = singletonFor((db: DrizzleDb) => new BudgetRepository(db));

/** `LiteLLM_BudgetTable` 的读写实现。 */
export class BudgetRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 按主键读取预算行；命中缓存时不再查库。
	 * @param budgetId - LiteLLM_BudgetTable.budget_id
	 * @returns 预算行或 null（负结果不缓存）
	 */
	async findById(budgetId: string): Promise<BudgetRow | null> {
		return await authRepositoryCache.load<BudgetRow>(authCacheKey.budget(budgetId), async () => {
			const rows = await this._db.select().from(LiteLLM_BudgetTable).where(eq(LiteLLM_BudgetTable.budget_id, budgetId)).limit(1);
			return rows.at(0) ?? null;
		});
	}

	/** 读取全部预算行；/customer/list 需要按 budget_id 建表做内存关联。 */
	async listAll(): Promise<BudgetRow[]> {
		return await this._db.select().from(LiteLLM_BudgetTable);
	}

	/**
	 * 新建预算行并返回新 budget_id。
	 *
	 * 组织/项目创建时先落预算再落实体，只需要 id 回填外键，避免把整行读回来占带宽。
	 * @param values - 可写入列
	 * @returns 新预算的 budget_id
	 */
	async create(values: BudgetInsertValues): Promise<string> {
		const inserted = await this._db.insert(LiteLLM_BudgetTable).values(values).returning({ budget_id: LiteLLM_BudgetTable.budget_id });
		const row = inserted.at(0);
		if (row === undefined) {
			throw new Error("预算插入未返回 budget_id");
		}
		authRepositoryCache.delete(authCacheKey.budget(row.budget_id));
		return row.budget_id;
	}

	/**
	 * 事务内按主键读取预算行（PATCH 组织后回填响应体）。
	 * @param tx - 事务句柄
	 * @param budgetId - 目标预算
	 * @returns 预算行数组（空数组表示不存在）
	 */
	async listByIdInTx(tx: BudgetTransaction, budgetId: string): Promise<BudgetRow[]> {
		return await tx.select().from(LiteLLM_BudgetTable).where(eq(LiteLLM_BudgetTable.budget_id, budgetId));
	}

	/**
	 * 事务内更新预算行（组织 PATCH 与预算字段联动）。
	 *
	 * 列集合由业务层按请求体映射决定，类型层无法逐列收窄；调用方已由 zod 校验。
	 * @param tx - 事务句柄
	 * @param budgetId - 目标预算
	 * @param values - 待更新列
	 * @returns 更新后的预算行数组（空数组表示预算行不存在）
	 */
	async updateInTx(tx: BudgetTransaction, budgetId: string, values: Record<string, unknown>): Promise<BudgetRow[]> {
		const updated = await tx
			.update(LiteLLM_BudgetTable)
			.set(values as BudgetUpdateValues)
			.where(eq(LiteLLM_BudgetTable.budget_id, budgetId))
			.returning();
		authRepositoryCache.delete(authCacheKey.budget(budgetId));
		return updated;
	}
}
