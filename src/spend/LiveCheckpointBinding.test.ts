import { bindLiveCheckpoint } from "./LiveCheckpointBinding";
import { getLiveResponse, resetLiveResponseRegistry, subscribeLiveResponse } from "./LiveResponseRegistry";

describe("bindLiveCheckpoint", () => {
	afterEach(() => {
		resetLiveResponseRegistry();
	});

	it("流式过程中只发布到内存，final 才落库，dispose 注销", async () => {
		const persistFinal = jest.fn().mockResolvedValue(undefined);
		const binding = bindLiveCheckpoint("req-b", () => ({ response: { text: "a" } }), persistFinal);
		const seen: unknown[] = [];
		subscribeLiveResponse("req-b", (snapshot) => seen.push(snapshot));

		await binding.write({ response: { text: "a" } }, { final: false });

		expect(seen).toEqual([{ response: { text: "a" } }]);
		expect(persistFinal).not.toHaveBeenCalled();

		await binding.write({ response: { text: "ab" } }, { final: true });

		expect(persistFinal).toHaveBeenCalledWith({ response: { text: "ab" } });
		expect(seen).toHaveLength(2);
		expect(binding.serialize()).toEqual({ response: { text: "a" } });
		expect(getLiveResponse("req-b")).toBeDefined();

		binding.onDispose();

		// 订阅者收到 null 表示实时数据结束，之后页面改读结算后的负载。
		expect(seen.at(-1)).toBeNull();
		expect(getLiveResponse("req-b")).toBeUndefined();
	});
});
