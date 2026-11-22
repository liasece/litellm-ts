/**
 * 持久层按键缓存的写穿与跨实体失效契约。
 *
 * 这里只验证可观察行为：写完再读是否拿到新值、删掉的行是否还读得到、删用户时是否
 * 连带清掉该用户名下其它表的缓存条目。断言不描述缓存内部结构，重构缓存实现时只要
 * 行为不变就不该改动本文件。
 */

import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_EndUserTable } from "../db/schema/end-users";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { endUserRepositoryFor } from "./EndUserRepository";
import { keyRepositoryFor } from "./KeyRepository";
import { teamRepositoryFor } from "./TeamRepository";

/** 各表的可变行集合；行对象整体替换，用来区分「读到缓存里的旧对象」与「重新查库」。 */
interface FakeTables {
	teams: Array<Record<string, unknown>>;
	memberships: Array<Record<string, unknown>>;
	endUsers: Array<Record<string, unknown>>;
	tokens?: Array<Record<string, unknown>>;
}

/**
 * 构造只支持被测链路的最小 Drizzle 替身：`select().from().where().limit()`、
 * `update().set().where().returning()`、`delete().where()`。
 *
 * `selectCalls` 记录进入查询的 `select()` 次数——命中缓存不会调用装载回调，所以它
 * 可以直接区分「读缓存」与「回库」。
 * @param tables - 初始表内容（会被就地修改）
 */
function makeFakeDb(tables: FakeTables): { db: DrizzleDb; selectCalls: () => number } {
	let selects = 0;
	const rowsOf = (table: unknown): Array<Record<string, unknown>> => {
		if (table === LiteLLM_TeamTable) {
			return tables.teams;
		}
		if (table === LiteLLM_TeamMembership) {
			return tables.memberships;
		}
		if (table === LiteLLM_EndUserTable) {
			return tables.endUsers;
		}
		if (table === LiteLLM_VerificationToken) {
			return tables.tokens ?? [];
		}
		return [];
	};
	const targetOf = rowsOf;
	const db = {
		select: () => {
			selects += 1;
			return {
				from: (table: unknown) => ({
					where: () => ({
						limit: async (count: number) => rowsOf(table).slice(0, count),
					}),
				}),
			};
		},
		update: (table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: () => ({
					returning: async () => {
						const rows = targetOf(table);
						if (rows.length === 0) {
							return [];
						}
						// 与真实驱动一致：返回新对象，不原地改写已可能被缓存引用的行。
						const next = { ...rows[0], ...values };
						rows[0] = next;
						return [next];
					},
				}),
			}),
		}),
		delete: (table: unknown) => ({
			where: async () => {
				const rows = targetOf(table);
				const removed = rows.length;
				rows.length = 0;
				return { rowCount: removed };
			},
		}),
	};
	return { db: db as unknown as DrizzleDb, selectCalls: () => selects };
}

describe("按键缓存写穿", () => {
	it("更新后同一实例读到的是刚落库的新值，且不再回库", async () => {
		const row = { teamId: "team-writethrough", teamAlias: "before", models: [] };
		const { db, selectCalls } = makeFakeDb({ teams: [row], memberships: [], endUsers: [] });
		const repository = teamRepositoryFor(db);

		expect((await repository.findById("team-writethrough"))?.teamAlias).toBe("before");

		const updated = await repository.updateById("team-writethrough", { teamAlias: "after" });
		const beforeRead = selectCalls();
		const reread = await repository.findById("team-writethrough");

		// 写穿：读到的是 UPDATE 返回的那一行，不是缓存里的旧对象，也没有再查一次库。
		expect(reread).toBe(updated);
		expect(reread?.teamAlias).toBe("after");
		expect(selectCalls()).toBe(beforeRead);
	});

	it("删除后的行再读返回 null，不会从缓存里复活", async () => {
		const endUser = { userId: "end-user-deleted", alias: "gone", spend: 0, blocked: false };
		const { db, selectCalls } = makeFakeDb({ teams: [], memberships: [], endUsers: [endUser] });
		const repository = endUserRepositoryFor(db);

		expect((await repository.findById("end-user-deleted"))?.alias).toBe("gone");

		await repository.deleteByIds(["end-user-deleted"]);
		const beforeRead = selectCalls();

		expect(await repository.findById("end-user-deleted")).toBeNull();
		// 必须回库确认「不存在」，而不是拿缓存里的旧行敷衍过去。
		expect(selectCalls()).toBeGreaterThan(beforeRead);
	});
});

describe("跨实体标签失效", () => {
	it("删用户名下密钥时，该用户的团队成员关系缓存一并失效", async () => {
		const tables: FakeTables = {
			teams: [],
			memberships: [{ userId: "user-tag", teamId: "team-tag", spend: 0, budgetId: null }],
			endUsers: [],
			tokens: [],
		};
		const { db, selectCalls } = makeFakeDb(tables);
		const teamRepository = teamRepositoryFor(db);

		expect((await teamRepository.findMembership("user-tag", "team-tag"))?.budgetId).toBeNull();

		// 另一条写入路径（记账结算）改了成员行，但没有经过本表仓储的写方法。
		// 整体换行而不是原地改字段，确保下面读到的只能是重新查库的新行。
		const settled = { userId: "user-tag", teamId: "team-tag", spend: 0, budgetId: "budget-settled" };
		tables.memberships[0] = settled;

		const beforeRead = selectCalls();
		// 删该用户的密钥会按 user 标签清掉该主体名下的全部缓存条目。
		await keyRepositoryFor(db).deleteByUserIds(["user-tag"]);

		const reread = await teamRepository.findMembership("user-tag", "team-tag");

		expect(reread).toBe(settled);
		expect(reread?.budgetId).toBe("budget-settled");
		expect(selectCalls()).toBeGreaterThan(beforeRead);
	});
});
