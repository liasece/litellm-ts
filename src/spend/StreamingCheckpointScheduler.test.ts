import { StreamingCheckpointScheduler } from "./StreamingCheckpointScheduler";

describe("StreamingCheckpointScheduler", () => {
	it("flush 序列化并写入", async () => {
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockReturnValue({ data: 1 });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		await scheduler.flush();

		expect(serialize).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith({ data: 1 });
	});

	it("serialize 返回 null 时跳过写入", async () => {
		const write = jest.fn();
		const serialize = jest.fn().mockReturnValue(null);
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		await scheduler.flush();

		expect(write).not.toHaveBeenCalled();
	});

	it("write 抛错由 onError 吞掉，flush 不 reject", async () => {
		const write = jest.fn().mockRejectedValue(new Error("boom"));
		const onError = jest.fn();
		const serialize = jest.fn().mockReturnValue({ data: 1 });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write, onError: onError });

		await expect(scheduler.flush()).resolves.toBeUndefined();

		expect(onError).toHaveBeenCalledWith(expect.any(Error));
	});

	it("多次 flush 串行执行，不并发", async () => {
		const events: string[] = [];
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const write = jest
			.fn()
			.mockImplementationOnce(async () => {
				events.push("write1-start");
				await firstGate;
				events.push("write1-end");
			})
			.mockImplementationOnce(async () => {
				events.push("write2");
			});
		const serialize = jest.fn().mockReturnValue({});
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		const first = scheduler.flush();
		const second = scheduler.flush();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual(["write1-start"]);

		releaseFirst();
		await Promise.all([first, second]);

		expect(events).toEqual(["write1-start", "write1-end", "write2"]);
	});

	it("onChunk 在时间窗口内只写一次（trailing debounce）", async () => {
		jest.useFakeTimers();
		try {
			const write = jest.fn().mockResolvedValue(undefined);
			const serialize = jest.fn().mockReturnValue({ data: 1 });
			const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write, intervalMs: 1000 });

			scheduler.onChunk();
			scheduler.onChunk();
			scheduler.onChunk();
			jest.advanceTimersByTime(1000);
			await Promise.resolve();
			await Promise.resolve();

			expect(serialize).toHaveBeenCalledTimes(1);
			expect(write).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
		}
	});

	it("dispose 会 flush 尚未落库的 dirty 状态", async () => {
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockReturnValue({ data: 1 });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		scheduler.onChunk();
		await scheduler.dispose();

		expect(write).toHaveBeenCalledTimes(1);
	});
});
