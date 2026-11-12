import {
	DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS,
	LARGE_STREAMING_CHECKPOINT_INTERVAL_MS,
	MAX_FAST_CHECKPOINT_BYTES,
	StreamingCheckpointScheduler,
	resolveStreamingCheckpointIntervalMs,
} from "./StreamingCheckpointScheduler";

describe("resolveStreamingCheckpointIntervalMs", () => {
	it("缺省与非法输入回落到默认值", () => {
		expect(resolveStreamingCheckpointIntervalMs(undefined)).toBe(DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS);
		expect(resolveStreamingCheckpointIntervalMs("  ")).toBe(DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS);
		expect(resolveStreamingCheckpointIntervalMs("abc")).toBe(DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS);
		expect(resolveStreamingCheckpointIntervalMs("0")).toBe(DEFAULT_STREAMING_CHECKPOINT_INTERVAL_MS);
	});

	it("把环境变量夹到可用区间", () => {
		expect(resolveStreamingCheckpointIntervalMs("50")).toBe(200);
		expect(resolveStreamingCheckpointIntervalMs("750")).toBe(750);
		expect(resolveStreamingCheckpointIntervalMs("60000")).toBe(5000);
	});
});

describe("StreamingCheckpointScheduler", () => {
	it("flush 序列化并写入", async () => {
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockReturnValue({ data: 1 });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		await scheduler.flush();

		expect(serialize).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith({ data: 1 }, { final: false });
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

	it("内容未变化时不重复写库", async () => {
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockImplementation(() => ({ response: { text: "abc" }, usage: null }));
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		await scheduler.flush();
		await scheduler.flush();

		expect(write).toHaveBeenCalledTimes(1);
		expect(scheduler.skippedUnchanged).toBe(1);
	});

	it("内容变化后再次写库", async () => {
		let text = "a";
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockImplementation(() => ({ response: { text: text } }));
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		await scheduler.flush();
		text = "ab";
		await scheduler.flush();

		expect(write).toHaveBeenCalledTimes(2);
		expect(scheduler.skippedUnchanged).toBe(0);
	});

	it("写失败后相同内容会重试，不被判为未变化", async () => {
		const write = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
		const onError = jest.fn();
		const serialize = jest.fn().mockReturnValue({ response: { text: "abc" } });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write, onError: onError });

		await scheduler.flush();
		await scheduler.flush();

		expect(write).toHaveBeenCalledTimes(2);
		expect(scheduler.skippedUnchanged).toBe(0);
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it("dispose 总会补写一次 final，即使内容与上一次相同", async () => {
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockReturnValue({ response: { text: "a" } });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write, intervalMs: 10_000 });

		await scheduler.flush();
		scheduler.onChunk();
		await scheduler.dispose();

		// 内容与上一次相同时，收尾落库仍必须发生：崩溃恢复依赖它拿到最终 usage。
		expect(write).toHaveBeenCalledTimes(2);
		expect(write).toHaveBeenNthCalledWith(1, { response: { text: "a" } }, { final: false });
		expect(write).toHaveBeenNthCalledWith(2, { response: { text: "a" } }, { final: true });
	});

	it("dispose 后调用 onDispose 注销实时快照", async () => {
		const onDispose = jest.fn();
		const scheduler = new StreamingCheckpointScheduler({
			serialize: () => ({ data: 1 }),
			write: jest.fn(),
			onDispose: onDispose,
		});

		await scheduler.dispose();

		expect(onDispose).toHaveBeenCalledTimes(1);
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
		let sequence = 0;
		const serialize = jest.fn().mockImplementation(() => ({ sequence: ++sequence }));
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
			let sequence = 0;
			const serialize = jest.fn().mockImplementation(() => ({ data: ++sequence }));
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

	it("大负载退回慢速窗口，避免高频重写整块 jsonb", async () => {
		jest.useFakeTimers();
		try {
			const write = jest.fn().mockResolvedValue(undefined);
			let sequence = 0;
			const serialize = jest.fn().mockImplementation(() => ({
				response: "x".repeat(MAX_FAST_CHECKPOINT_BYTES + 1),
				sequence: ++sequence,
			}));
			const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write, intervalMs: 400 });

			await scheduler.flush();
			expect(write).toHaveBeenCalledTimes(1);

			// 大负载之后，下一个窗口应该是慢速窗口而不是 400ms。
			scheduler.onChunk();
			jest.advanceTimersByTime(400);
			await Promise.resolve();
			expect(write).toHaveBeenCalledTimes(1);

			jest.advanceTimersByTime(LARGE_STREAMING_CHECKPOINT_INTERVAL_MS);
			await Promise.resolve();
			await Promise.resolve();
			expect(write).toHaveBeenCalledTimes(2);
		} finally {
			jest.useRealTimers();
		}
	});

	it("小负载保持快速窗口", async () => {
		jest.useFakeTimers();
		try {
			const write = jest.fn().mockResolvedValue(undefined);
			const scheduler = new StreamingCheckpointScheduler({
				serialize: () => ({ response: "短文本" }),
				write: write,
				intervalMs: 400,
			});

			scheduler.onChunk();
			jest.advanceTimersByTime(400);
			await Promise.resolve();
			await Promise.resolve();

			expect(write).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
		}
	});

	it("dispose 会 flush 尚未发布的内容", async () => {
		const write = jest.fn().mockResolvedValue(undefined);
		const serialize = jest.fn().mockReturnValue({ data: 1 });
		const scheduler = new StreamingCheckpointScheduler({ serialize: serialize, write: write });

		scheduler.onChunk();
		await scheduler.dispose();

		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith({ data: 1 }, { final: true });
	});
});
