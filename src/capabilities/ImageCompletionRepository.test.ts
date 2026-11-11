import type { DrizzleDb } from "../core/db/Database";
import { DatabaseImageHistoryRepository, resetImageHistoryNegativeCache } from "./ImageCompletionRepository";

/**
 * 假库：hasHistory 的 select 计数，写入侧（complete/bind）走同一个 transaction 句柄。
 * @param state - rows 为 hasHistory 查询返回的行
 */
function createFakeDb(state: { rows: unknown[] }): { db: DrizzleDb; selects: () => number } {
	let selects = 0;
	let db: Record<string, unknown>;
	db = {
		select: jest.fn(() => {
			selects += 1;
			return {
				from: jest.fn(() => ({
					where: jest.fn(() => ({ limit: jest.fn(() => Promise.resolve(state.rows)) })),
				})),
			};
		}),
		insert: jest.fn(() => ({ values: jest.fn(() => ({ onConflictDoNothing: jest.fn(() => Promise.resolve()) })) })),
		update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })) })),
		transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
	};
	return { db: db as unknown as DrizzleDb, selects: () => selects };
}

describe("图片历史负结果缓存", () => {
	beforeEach(() => {
		resetImageHistoryNegativeCache();
	});

	it("没有图片历史的 scope 在缓存有效期内不再回查", async () => {
		const { db, selects } = createFakeDb({ rows: [] });
		const repository = new DatabaseImageHistoryRepository(db);

		await expect(repository.hasHistory("scope-a")).resolves.toBe(false);
		await expect(repository.hasHistory("scope-a")).resolves.toBe(false);
		expect(selects()).toBe(1);

		// 别的会话仍然各自查询，不能把负结果当成全局结论。
		await expect(repository.hasHistory("scope-b")).resolves.toBe(false);
		expect(selects()).toBe(2);
	});

	it("写入图片锚点后同一 scope 立刻重新查询并拿到历史", async () => {
		const state: { rows: unknown[] } = { rows: [] };
		const { db, selects } = createFakeDb(state);
		const repository = new DatabaseImageHistoryRepository(db);

		await expect(repository.hasHistory("scope-a")).resolves.toBe(false);
		expect(selects()).toBe(1);

		await repository.complete("scope-a", "operation-1", [{ id: "asset-1" } as never]);
		state.rows = [{ anchor: "image:asset-1" }];
		await expect(repository.hasHistory("scope-a")).resolves.toBe(true);
		expect(selects()).toBe(2);
	});

	it("bind 写入回复锚点后同样失效", async () => {
		const state: { rows: unknown[] } = { rows: [] };
		const { db, selects } = createFakeDb(state);
		const repository = new DatabaseImageHistoryRepository(db);

		await expect(repository.hasHistory("scope-a")).resolves.toBe(false);
		await repository.bind("scope-a", ["call:abc"], "reply-1", ["operation-1"]);
		state.rows = [{ anchor: "call:abc" }];
		await expect(repository.hasHistory("scope-a")).resolves.toBe(true);
		expect(selects()).toBe(2);
	});
});
