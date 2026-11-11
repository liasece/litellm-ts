import { appendModelResolutionTrace, appendRoutingTrace } from "./ModelResolutionTrace";
import {
	captureUpstreamExchange,
	createPublishedModelResolutionTrace,
	getRecordedModelResolutionTrace,
	getRecordedUpstreamExchange,
	observeUpstreamExchange,
	recordUpstreamExchange,
	runWithUpstreamExchangeScope,
} from "./UpstreamExchange";
import type { UpstreamLogContext } from "./UpstreamLogContext";

function context(url: string): UpstreamLogContext {
	return {
		request: { url: url, method: "POST", headers: {}, body: { model: "provider-model" } },
		response: { status_code: 200, headers: {}, body: { ok: true } },
	};
}

describe("upstream exchange channel", () => {
	test("重建结果对象的中间层不影响已记录的上游交换", async () => {
		const outer = context("https://provider.example/v1/chat/completions");

		await runWithUpstreamExchangeScope(async () => {
			recordUpstreamExchange(outer);
			// 这些正是历史上把 Symbol 弄丢的重建方式：能力循环累积、对象展开、entries 复制。
			const rebuilt = { ...{ id: "chatcmpl-1", choices: [] } };
			const entriesCopy = Object.fromEntries(Object.entries({ id: "chatcmpl-2" }));

			expect(getRecordedUpstreamExchange()).toBe(outer);
			expect(rebuilt).not.toHaveProperty("upstream");
			expect(entriesCopy).not.toHaveProperty("upstream");
			expect(getRecordedUpstreamExchange()?.request.url).toBe("https://provider.example/v1/chat/completions");
		});
	});

	test("worker 子作用域记录自己的上游交换且不覆盖外层", async () => {
		const outer = context("https://provider.example/v1/responses");
		const worker = context("https://api.deepseek.com/chat/completions");

		await runWithUpstreamExchangeScope(async () => {
			recordUpstreamExchange(outer);

			const captured = await captureUpstreamExchange(async () => {
				recordUpstreamExchange(worker);
				return "worker-result";
			});

			expect(captured.result).toBe("worker-result");
			expect(captured.context).toBe(worker);
			expect(getRecordedUpstreamExchange()).toBe(outer);
		});
	});

	test("没有作用域时记录被忽略且读取为空", () => {
		recordUpstreamExchange(context("https://provider.example/v1/chat/completions"));
		expect(getRecordedUpstreamExchange()).toBeUndefined();
	});

	test("endpoint 自建的请求级轨迹被发布，观察者在每次上游交换都能读到 fallback 进度", () => {
		const seen: Array<{ models: readonly string[]; depth: number; routing: number }> = [];
		runWithUpstreamExchangeScope(() => {
			observeUpstreamExchange(() => {
				const trace = getRecordedModelResolutionTrace();
				seen.push({
					models: [...(trace?.fallbackModels ?? [])],
					depth: trace?.fallbackDepth ?? -1,
					routing: trace?.routingTrace.length ?? -1,
				});
			});

			// endpoint 的 fallback 循环：建立请求作用域时创建并发布轨迹，不再等 Router 发布。
			const trace = createPublishedModelResolutionTrace();
			appendModelResolutionTrace(trace, 0, {
				inputModel: "qwen3.8-27b",
				resolvedModel: "anthropic/vllm-qwen3.8-27b",
				resolutionPath: ["qwen3.8-27b", "anthropic/vllm-qwen3.8-27b"],
			});
			recordUpstreamExchange(context("https://provider.example/v1/chat/completions"));

			// 首个上游失败后推进 fallback：追加第二项并记录决策。
			appendModelResolutionTrace(trace, 1, {
				inputModel: "minimax-latest-anthropic",
				resolvedModel: "minimax/MiniMax-M3.1-Flash",
				resolutionPath: ["minimax-latest-anthropic", "minimax/MiniMax-M3.1-Flash"],
			});
			appendRoutingTrace(trace, {
				fromModel: "qwen3.8-27b",
				toResolution: {
					inputModel: "minimax-latest-anthropic",
					resolvedModel: "minimax/MiniMax-M3.1-Flash",
					resolutionPath: ["minimax-latest-anthropic", "minimax/MiniMax-M3.1-Flash"],
				},
				routingType: "general_fallback",
				error: new TypeError("fetch failed"),
			});
			recordUpstreamExchange(context("https://provider.example/v1/chat/completions"));
		});

		expect(seen).toEqual([
			{ models: ["qwen3.8-27b"], depth: 0, routing: 0 },
			{ models: ["qwen3.8-27b", "minimax/MiniMax-M3.1-Flash"], depth: 1, routing: 1 },
		]);
	});

	test("不在请求作用域内创建轨迹时只返回容器", () => {
		const trace = createPublishedModelResolutionTrace();

		expect(trace.fallbackModels).toEqual([]);
		expect(getRecordedModelResolutionTrace()).toBeUndefined();
	});
});
