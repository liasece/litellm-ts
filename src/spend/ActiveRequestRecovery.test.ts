import { abortOrphanedActiveRequests, reapExpiredActiveRequests } from "./ActiveRequestRecovery";

/** 拼出 drizzle `sql` 模板的文本形态（参数值不参与断言）。 */
function sqlText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sqlText).join("");
	}
	if (value && typeof value === "object") {
		const record = value as { queryChunks?: unknown[]; value?: unknown };
		if (record.queryChunks) {
			return record.queryChunks.map(sqlText).join("");
		}
		if (Array.isArray(record.value)) {
			return record.value.map(sqlText).join("");
		}
	}
	return "";
}

function captureStatements(): { execute: jest.Mock; statements: string[] } {
	const statements: string[] = [];
	const execute = jest.fn(async (statement: unknown) => {
		statements.push(sqlText(statement));
		return { rows: [] };
	});
	return { execute, statements };
}

function runWith(execute: jest.Mock) {
	return { transaction: (callback: (tx: { execute: jest.Mock }) => Promise<number>) => callback({ execute }) } as never;
}

describe("active request startup recovery", () => {
	it("converts all old-process in-progress rows in one transaction", async () => {
		const execute = jest.fn().mockResolvedValue({
			rows: [{ request_id: "req-a" }, { request_id: "req-b" }],
		});
		const transaction = jest.fn((callback: (tx: { execute: typeof execute }) => Promise<number>) => callback({ execute: execute }));
		const abortedAt = new Date("2026-07-27T12:00:00.000Z");

		await expect(abortOrphanedActiveRequests({ transaction: transaction } as never, abortedAt)).resolves.toBe(2);

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("returns zero when the previous process left no active requests", async () => {
		const execute = jest.fn().mockResolvedValue({ rows: [] });
		const transaction = jest.fn((callback: (tx: { execute: typeof execute }) => Promise<number>) => callback({ execute: execute }));

		await expect(abortOrphanedActiveRequests({ transaction: transaction } as never)).resolves.toBe(0);
	});

	it("两条恢复 INSERT 都同时写入过滤列，错误码与写入的 metadata 一致", async () => {
		// 这两条语句是近乎重复的：漏改其中一条会让被回收的行在 Logs 表头过滤里查不到
		// （列值为空），而现象只在重启或租约过期后才出现，所以在这里锁定契约。
		const { execute, statements } = captureStatements();
		await abortOrphanedActiveRequests(runWith(execute), new Date("2026-07-27T12:00:00.000Z"));
		await reapExpiredActiveRequests(runWith(execute), new Date("2026-07-27T12:00:00.000Z"));

		expect(statements).toHaveLength(2);
		for (const statement of statements) {
			expect(statement).toContain("key_alias");
			expect(statement).toContain("error_code");
			expect(statement).toContain("metadata ->> 'user_api_key_alias'");
		}
		expect(statements[0]).toContain("'SERVER_RESTART'");
		expect(statements[1]).toContain("'LEASE_EXPIRED'");
	});
});
