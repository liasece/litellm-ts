import {
	appendModelResolutionTrace,
	createModelResolutionTraceCollector,
	getResultModelResolutionMetadata,
} from "./ModelResolutionTrace";

describe("ModelResolutionTrace", () => {
	it("保留原始请求作为 fallback_models 首项，alias 跳数不增加 fallback 深度", () => {
		const collector = createModelResolutionTraceCollector();

		appendModelResolutionTrace(collector, 0, {
			inputModel: "request-alias",
			resolvedModel: "request-model",
			resolutionPath: ["request-alias", "nested-alias", "request-model"],
		});

		expect(collector.fallbackDepth).toBe(0);
		expect(collector.fallbackModels).toEqual(["request-alias"]);
		expect(collector.entries).toHaveLength(1);

		appendModelResolutionTrace(collector, 1, {
			inputModel: "fallback-alias",
			resolvedModel: "fallback-model",
			resolutionPath: ["fallback-alias", "fallback-model"],
		});

		expect(collector.fallbackDepth).toBe(1);
		expect(collector.fallbackModels).toEqual(["request-alias", "fallback-model"]);
	});

	it("从 Router 成功结果提取完整 fallback 与 alias 轨迹", () => {
		expect(
			getResultModelResolutionMetadata({
				_fallbackModels: ["A", "C"],
				_modelResolutionChain: [
					{ fallback_index: 0, input_model: "A", resolved_model: "B", resolution_path: ["A", "B"] },
					{ fallback_index: 1, input_model: "fallback-alias", resolved_model: "C", resolution_path: ["fallback-alias", "C"] },
				],
			}),
		).toEqual({
			fallbackModels: ["A", "C"],
			modelResolutionChain: [
				{ fallback_index: 0, input_model: "A", resolved_model: "B", resolution_path: ["A", "B"] },
				{ fallback_index: 1, input_model: "fallback-alias", resolved_model: "C", resolution_path: ["fallback-alias", "C"] },
			],
			attemptedRetries: 1,
		});
	});
});
