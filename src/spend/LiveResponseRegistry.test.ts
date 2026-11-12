import {
	getLiveResponse,
	liveResponseCount,
	pendingLiveResponseCount,
	publishLiveResponse,
	readLiveResponseSequence,
	readLiveResponseSnapshot,
	registerLiveResponse,
	resetLiveResponseRegistry,
	subscribeLiveResponse,
	unregisterLiveResponse,
} from "./LiveResponseRegistry";

describe("LiveResponseRegistry", () => {
	afterEach(() => {
		resetLiveResponseRegistry();
	});

	it("登记后可以读到当前快照", () => {
		let text = "he";
		registerLiveResponse("req-1", () => ({ response: { text } }));

		expect(readLiveResponseSnapshot("req-1")).toEqual({ response: { text: "he" } });
		text = "hello";
		// 快照是闭包，读到的是调用瞬间的内容，不需要等 publish。
		expect(readLiveResponseSnapshot("req-1")).toEqual({ response: { text: "hello" } });
		expect(getLiveResponse("req-1")?.snapshot()).toEqual({ response: { text: "hello" } });
	});

	it("publish 把最新快照推给订阅者", () => {
		registerLiveResponse("req-1", () => null);
		const seen: unknown[] = [];
		const unsubscribe = subscribeLiveResponse("req-1", (snapshot) => seen.push(snapshot));

		publishLiveResponse("req-1", { response: { text: "a" } });
		publishLiveResponse("req-1", { response: { text: "ab" } });
		unsubscribe();
		publishLiveResponse("req-1", { response: { text: "abc" } });

		expect(seen).toEqual([{ response: { text: "a" } }, { response: { text: "ab" } }]);
	});

	it("发布序号单调递增，未登记时为 0", () => {
		expect(readLiveResponseSequence("req-seq")).toBe(0);
		registerLiveResponse("req-seq", () => null);
		expect(readLiveResponseSequence("req-seq")).toBe(0);

		publishLiveResponse("req-seq", { response: { text: "a" } });
		const first = readLiveResponseSequence("req-seq");
		publishLiveResponse("req-seq", { response: { text: "ab" } });
		const second = readLiveResponseSequence("req-seq");

		expect(first).toBeGreaterThan(0);
		expect(second).toBeGreaterThan(first);
	});

	it("注销时通知订阅者实时数据结束，并清掉条目", () => {
		registerLiveResponse("req-1", () => null);
		const seen: unknown[] = [];
		subscribeLiveResponse("req-1", (snapshot) => seen.push(snapshot));

		unregisterLiveResponse("req-1");

		expect(seen).toEqual([null]);
		expect(getLiveResponse("req-1")).toBeUndefined();
		expect(liveResponseCount()).toBe(0);
	});

	it("单个订阅者抛错不影响其他订阅者与后续发布", () => {
		registerLiveResponse("req-1", () => null);
		const seen: unknown[] = [];
		subscribeLiveResponse("req-1", () => {
			throw new Error("boom");
		});
		subscribeLiveResponse("req-1", (snapshot) => seen.push(snapshot));

		expect(() => publishLiveResponse("req-1", { response: { text: "a" } })).not.toThrow();
		expect(seen).toEqual([{ response: { text: "a" } }]);
	});

	it("没有登记的请求：发布是空操作，订阅先暂存、登记后自动接到推送", () => {
		const listener = jest.fn();
		expect(() => publishLiveResponse("req-late", { response: {} })).not.toThrow();
		subscribeLiveResponse("req-late", listener);
		expect(pendingLiveResponseCount()).toBe(1);

		// 执行流稍后才登记（真实时序：上游响应返回才开始流式）。
		registerLiveResponse("req-late", () => ({ response: { text: "a" } }));

		expect(pendingLiveResponseCount()).toBe(0);
		publishLiveResponse("req-late", { response: { text: "ab" } });
		expect(listener).toHaveBeenCalledWith({ response: { text: "ab" } });
		expect(readLiveResponseSnapshot("missing")).toBeNull();
	});

	it("取消暂存订阅后不再被登记采纳", () => {
		const listener = jest.fn();
		const unsubscribe = subscribeLiveResponse("req-cancel", listener);
		unsubscribe();

		registerLiveResponse("req-cancel", () => null);
		publishLiveResponse("req-cancel", { response: { text: "a" } });

		expect(listener).not.toHaveBeenCalled();
		expect(pendingLiveResponseCount()).toBe(0);
	});

	it("条目数超过上限时淘汰最早登记的请求，避免漏注销累积内存", () => {
		for (let index = 0; index < 70; index += 1) {
			registerLiveResponse(`req-${index}`, () => null);
		}

		expect(liveResponseCount()).toBe(64);
		expect(getLiveResponse("req-69")).toBeDefined();
		expect(getLiveResponse("req-0")).toBeUndefined();
	});

	it("重新登记同一请求会替换旧快照", () => {
		registerLiveResponse("req-1", () => ({ response: { text: "old" } }));
		registerLiveResponse("req-1", () => ({ response: { text: "new" } }));

		expect(liveResponseCount()).toBe(1);
		expect(readLiveResponseSnapshot("req-1")).toEqual({ response: { text: "new" } });
	});
});
