import { getRecordedUpstreamExchange, recordUpstreamExchange, runWithUpstreamExchangeScope, captureUpstreamExchange } from "./UpstreamExchange";
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
});
