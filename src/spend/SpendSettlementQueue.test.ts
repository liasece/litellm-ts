import type { SpendLog } from "../types/spend";

jest.mock("./SpendTracker", () => ({
	trackSpendLog: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const spendTracker = require("./SpendTracker") as { trackSpendLog: jest.Mock };

import { SpendSettlementQueue } from "./SpendSettlementQueue";

function createEntry(requestId: string): SpendLog {
	return { request_id: requestId, api_key: "sk-test" } as unknown as SpendLog;
}

const db = {} as never;

describe("SpendSettlementQueue", () => {
	beforeEach(() => {
		spendTracker.trackSpendLog.mockReset();
		spendTracker.trackSpendLog.mockResolvedValue({ status: "committed", requestId: "x", spend: 0 });
	});

	it("入队立即返回，后台冲刷时才落库", async () => {
		const queue = new SpendSettlementQueue({ immediate: false, flushIntervalMs: 10_000 });

		await queue.enqueue(db, createEntry("req-1"));

		expect(spendTracker.trackSpendLog).not.toHaveBeenCalled();
		expect(queue.pending).toBe(1);

		await queue.flush(1000);

		expect(spendTracker.trackSpendLog).toHaveBeenCalledTimes(1);
		expect(spendTracker.trackSpendLog).toHaveBeenCalledWith(db, expect.objectContaining({ request_id: "req-1" }));
		expect(queue.pending).toBe(0);
		expect(queue.completed).toBe(1);
	});

	it("达到批量阈值立即冲刷，不等窗口到期", async () => {
		const queue = new SpendSettlementQueue({ immediate: false, flushIntervalMs: 10_000, batchSize: 2 });

		await queue.enqueue(db, createEntry("req-1"));
		await queue.enqueue(db, createEntry("req-2"));

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(spendTracker.trackSpendLog).toHaveBeenCalledTimes(2);
	});

	it("写失败放回队首并按退避重试", async () => {
		spendTracker.trackSpendLog.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ status: "committed" });
		const queue = new SpendSettlementQueue({
			immediate: false,
			flushIntervalMs: 10_000,
			retryBaseDelayMs: 10,
			maxRetryDelayMs: 20,
		});

		await queue.enqueue(db, createEntry("req-1"));
		await queue.flush(2000);

		expect(spendTracker.trackSpendLog).toHaveBeenCalledTimes(2);
		expect(queue.failed).toBe(1);
		expect(queue.completed).toBe(1);
		expect(queue.pending).toBe(0);
	});

	it("队列满时改为同步写这一条", async () => {
		const queue = new SpendSettlementQueue({ immediate: false, flushIntervalMs: 10_000, maxPending: 1 });

		await queue.enqueue(db, createEntry("req-1"));
		await queue.enqueue(db, createEntry("req-2"));

		expect(spendTracker.trackSpendLog).toHaveBeenCalledTimes(1);
		expect(spendTracker.trackSpendLog).toHaveBeenCalledWith(db, expect.objectContaining({ request_id: "req-2" }));
		expect(queue.pending).toBe(1);
	});

	it("等待超时返回 false 且保留积压", async () => {
		spendTracker.trackSpendLog.mockRejectedValue(new Error("db down"));
		const queue = new SpendSettlementQueue({
			immediate: false,
			flushIntervalMs: 10_000,
			retryBaseDelayMs: 50,
			maxRetryDelayMs: 50,
		});

		await queue.enqueue(db, createEntry("req-1"));
		const drained = await queue.flush(120);

		expect(drained).toBe(false);
		expect(queue.pending).toBe(1);
	});

	it("immediate 模式入队即落库", async () => {
		const queue = new SpendSettlementQueue({ immediate: true });

		await queue.enqueue(db, createEntry("req-1"));

		expect(spendTracker.trackSpendLog).toHaveBeenCalledTimes(1);
		expect(queue.pending).toBe(0);
	});
});
