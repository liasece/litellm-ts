import {
	appendModelResolutionTrace,
	appendRoutingTrace,
	attachModelResolutionMetadataToError,
	copyRoutingTrace,
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

	it("记录每次 fallback 的路由类型、原因和原始错误", () => {
		const collector = createModelResolutionTraceCollector();
		appendRoutingTrace(collector, {
			fromModel: "primary",
			toResolution: {
				inputModel: "fallback-alias",
				resolvedModel: "fallback-model",
				resolutionPath: ["fallback-alias", "fallback-model"],
			},
			routingType: "general_fallback",
			reason: "rate_limit",
			error: Object.assign(new Error("RPM quota exhausted"), { name: "RateLimitError", statusCode: 429 }),
			attemptedDeployment: "openai/primary",
		});

		expect(copyRoutingTrace(collector)).toEqual([
			{
				fallback_index: 1,
				from_model: "primary",
				to_model: "fallback-alias",
				to_resolved_model: "fallback-model",
				resolution_path: ["fallback-alias", "fallback-model"],
				routing_type: "general_fallback",
				reason: "rate_limit",
				attempted_deployment: "openai/primary",
				error_information: {
					error_type: "RateLimitError",
					error_code: 429,
					error_message: "RPM quota exhausted",
				},
			},
		]);
	});

	it("最终失败时以不可枚举属性把路由轨迹交给日志层", () => {
		const collector = createModelResolutionTraceCollector();
		appendModelResolutionTrace(collector, 0, { inputModel: "primary", resolvedModel: "primary", resolutionPath: ["primary"] });
		appendRoutingTrace(collector, {
			fromModel: "primary",
			toResolution: { inputModel: "fallback", resolvedModel: "fallback", resolutionPath: ["fallback"] },
			routingType: "general_fallback",
			error: new Error("provider unavailable"),
		});
		appendModelResolutionTrace(collector, 1, {
			inputModel: "fallback",
			resolvedModel: "fallback",
			resolutionPath: ["fallback"],
		});
		const error = new Error("all routes failed");

		attachModelResolutionMetadataToError(error, collector);

		expect(JSON.stringify(error)).toBe("{}");
		expect(getResultModelResolutionMetadata(error as unknown as Record<string, unknown>)).toMatchObject({
			fallbackModels: ["primary", "fallback"],
			attemptedRetries: 1,
			routingTrace: [expect.objectContaining({ from_model: "primary", to_resolved_model: "fallback" })],
		});
	});
});
