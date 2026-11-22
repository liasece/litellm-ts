import { SubscriptionAccountRepository } from "./SubscriptionAccountRepository";

/**
 * 数据库行夹具。
 * @param overrides - 覆盖字段
 */
function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return {
		account_id: "account-1",
		provider: "codex",
		account_key: "codex-a.json",
		payload: { type: "codex", access_token: "old-access" },
		trashed_at: null,
		created_at: new Date("2026-01-01T00:00:00.000Z"),
		updated_at: new Date("2026-01-01T00:00:00.000Z"),
		...overrides,
	};
}

describe("SubscriptionAccountRepository", () => {
	it("insert 把账号正文写进 payload，回收站状态写进 trashed_at", async () => {
		const values = jest.fn();
		const db = { insert: jest.fn().mockReturnValue({ values }) };
		const repository = new SubscriptionAccountRepository(db as never);

		await repository.insert({ id: "account-1", source: "codex", key: "codex-a.json", payload: { type: "codex" }, trashedAt: null });
		expect(values).toHaveBeenCalledWith({
			account_id: "account-1",
			provider: "codex",
			account_key: "codex-a.json",
			payload: { type: "codex" },
			trashed_at: null,
		});
	});

	it("list 将数据库行映射为账号行，异常 payload 退化为空对象", async () => {
		const rows = [
			row(),
			row({ account_id: "account-2", account_key: "codex-b.json", payload: "broken", trashed_at: new Date(1_700_000_000_000) }),
		];
		const db = { select: jest.fn().mockReturnValue({ from: jest.fn().mockResolvedValue(rows) }) };
		const repository = new SubscriptionAccountRepository(db as never);

		await expect(repository.list()).resolves.toEqual([
			expect.objectContaining({ id: "account-1", source: "codex", key: "codex-a.json", trashedAt: null }),
			expect.objectContaining({ id: "account-2", key: "codex-b.json", payload: {}, trashedAt: new Date(1_700_000_000_000) }),
		]);
	});

	it("find/findByKey 只返回匹配的行", async () => {
		// 同一 where 结果既要能 await（findByKey），又要能链 .limit（find）。
		const result = Object.assign(Promise.resolve([row()]), { limit: jest.fn().mockResolvedValue([row()]) });
		const where = jest.fn().mockReturnValue(result);
		const from = jest.fn().mockReturnValue({ where });
		const db = { select: jest.fn().mockReturnValue({ from }) };
		const repository = new SubscriptionAccountRepository(db as never);

		await expect(repository.find("account-1")).resolves.toMatchObject({ id: "account-1" });
		await expect(repository.findByKey("codex", "codex-a.json")).resolves.toHaveLength(1);
		expect(from).toHaveBeenCalledTimes(2);
	});

	it("update 刷新 updated_at 并返回更新后的行；零行返回 undefined", async () => {
		const returning = jest
			.fn()
			.mockResolvedValueOnce([row({ trashed_at: new Date(1_700_000_000_000) })])
			.mockResolvedValueOnce([]);
		const set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
		const db = { update: jest.fn().mockReturnValue({ set }) };
		const repository = new SubscriptionAccountRepository(db as never);

		await expect(repository.update("account-1", { trashedAt: new Date(1_700_000_000_000) })).resolves.toMatchObject({
			trashedAt: new Date(1_700_000_000_000),
		});
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({ trashed_at: new Date(1_700_000_000_000), updated_at: expect.any(Date) }),
		);
		await expect(repository.update("missing", { payload: {} })).resolves.toBeUndefined();
	});

	it("remove 按账号 ID 删除行", async () => {
		const where = jest.fn().mockResolvedValue(undefined);
		const db = { delete: jest.fn().mockReturnValue({ where }) };
		const repository = new SubscriptionAccountRepository(db as never);

		await repository.remove("account-1");
		expect(where).toHaveBeenCalledTimes(1);
	});
});
