import { abortOrphanedActiveRequests } from "./ActiveRequestRecovery";

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
});
