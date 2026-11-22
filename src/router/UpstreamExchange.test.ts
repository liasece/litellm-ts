import { appendModelResolutionTrace, appendRoutingTrace } from "./ModelResolutionTrace";
import {
	captureUpstreamExchange,
	createPublishedModelResolutionTrace,
	getRecordedModelResolutionTrace,
	getRecordedUpstreamErrors,
	getRecordedUpstreamExchange,
	getRecordedUpstreamIdentity,
	observeUpstreamExchange,
	recordUpstreamExchange,
	recordUpstreamIdentity,
	runWithUpstreamExchangeScope,
} from "./UpstreamExchange";
import type { UpstreamLogContext } from "../types/upstreamLog";

function context(url: string): UpstreamLogContext {
	return {
		request: { url: url, method: "POST", headers: {}, body: { model: "provider-model" } },
		response: { status_code: 200, headers: {}, body: { ok: true } },
	};
}

function upstreamError(url: string, status_code: number, body: unknown): UpstreamLogContext {
	return {
		request: { url: url, method: "POST", headers: {}, body: { model: "provider-model" } },
		response: { status_code: status_code, headers: {}, body: body },
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

	test("上游交换上下文合并当前 key 指纹与账号，切换尝试时移除旧账号", async () => {
		await runWithUpstreamExchangeScope(async () => {
			recordUpstreamIdentity({
				keyHash: "a".repeat(64),
				account: { kind: "credential", id: "credential-a", provider: "openai" },
			});
			recordUpstreamExchange(context("https://provider.example/v1/chat/completions"));
			expect(getRecordedUpstreamExchange()).toMatchObject({
				upstreamKeyHash: "a".repeat(64),
				upstreamAccount: { kind: "credential", id: "credential-a", provider: "openai" },
			});

			// fallback 到另一个没有账号归属的 key：不能沿用上一账号。
			recordUpstreamIdentity({ keyHash: "b".repeat(64) });
			recordUpstreamExchange(context("https://provider.example/v1/chat/completions"));
			expect(getRecordedUpstreamExchange()).toMatchObject({ upstreamKeyHash: "b".repeat(64) });
			expect(getRecordedUpstreamExchange()).not.toHaveProperty("upstreamAccount");

			recordUpstreamIdentity(undefined);
			recordUpstreamExchange(context("https://provider.example/v1/chat/completions"));
			expect(getRecordedUpstreamExchange()).not.toHaveProperty("upstreamKeyHash");
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

	test("重试与 fallback 的上游错误按发生顺序累积，成功交换与重复错误不进入列表", () => {
		runWithUpstreamExchangeScope(() => {
			recordUpstreamExchange(
				upstreamError("https://provider.example/a", 429, { error: { type: "server_error", message: "overloaded" } }),
			);
			recordUpstreamExchange(
				upstreamError("https://provider.example/b", 500, { error: { type: "server_error", message: "bad gateway" } }),
			);
			recordUpstreamExchange(context("https://provider.example/ok"));
			// 同一 URL/状态/类别/文案只算一次，避免重试风暴把日志详情刷屏。
			recordUpstreamExchange(
				upstreamError("https://provider.example/a", 429, { error: { type: "server_error", message: "overloaded" } }),
			);

			expect(getRecordedUpstreamErrors()).toEqual([
				{ url: "https://provider.example/a", status_code: 429, type: "server_error", message: "overloaded" },
				{ url: "https://provider.example/b", status_code: 500, type: "server_error", message: "bad gateway" },
			]);
		});
	});

	test("上游错误体为 JSON 字符串或标量错误时也能提取可读文案", () => {
		runWithUpstreamExchangeScope(() => {
			recordUpstreamExchange(
				upstreamError("https://provider.example/a", 429, '{"error":{"type":"rate_limit","message":"quota exceeded"}}'),
			);
			recordUpstreamExchange(upstreamError("https://provider.example/b", 502, { error: "upstream unavailable" }));

			expect(getRecordedUpstreamErrors()).toEqual([
				{ url: "https://provider.example/a", status_code: 429, type: "rate_limit", message: "quota exceeded" },
				{ url: "https://provider.example/b", status_code: 502, type: "upstream_error", message: "upstream unavailable" },
			]);
		});
	});

	test("不同请求作用域的上游错误互不串扰，返回值修改不影响后续读取", () => {
		runWithUpstreamExchangeScope(() => {
			recordUpstreamExchange(upstreamError("https://provider.example/a", 500, { error: { message: "failed" } }));
			expect(getRecordedUpstreamErrors()).toHaveLength(1);
		});
		runWithUpstreamExchangeScope(() => {
			const errors = getRecordedUpstreamErrors();
			expect(errors).toEqual([]);
			errors.push({ url: "x", status_code: 500, type: "x", message: "x" });
			expect(getRecordedUpstreamErrors()).toEqual([]);
		});
	});
});
