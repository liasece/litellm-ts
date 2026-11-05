/** DeepSeek 推理回显被拒时的降级判定测试。 */

import { buildThinkingDowngradedResponsesBody, isThinkingReplayRejection } from "./DeepSeekReasoningReplay";

describe("isThinkingReplayRejection", () => {
	it("识别 DeepSeek 的推理回显拒绝", () => {
		const error = new Error(
			'server_error: {"error":{"message":"The `reasoning_text` in the thinking mode must be passed back to the API. (request_id: x)"}}',
		);

		expect(isThinkingReplayRejection(error)).toBe(true);
	});

	it("其它上游错误不触发降级", () => {
		expect(isThinkingReplayRejection(new Error("Connection error."))).toBe(false);
		expect(isThinkingReplayRejection(new Error("No tool output found for tool call call_1"))).toBe(false);
		expect(isThinkingReplayRejection(undefined)).toBe(false);
	});
});

describe("buildThinkingDowngradedResponsesBody", () => {
	it("关闭思考并保留请求体其它字段", () => {
		const body = { input: [{ role: "user", content: "hi" }], tools: [{ type: "function", name: "f" }], reasoning: { effort: "high" } };

		const result = buildThinkingDowngradedResponsesBody("responses", body);

		expect(result).toEqual({ ...body, reasoning: { effort: "none" } });
		expect(body.reasoning).toEqual({ effort: "high" });
	});

	it("没有 tools 时不降级", () => {
		expect(buildThinkingDowngradedResponsesBody("responses", { input: "hi" })).toBeUndefined();
	});

	it("已经关闭思考时不重复降级", () => {
		const body = { tools: [{ type: "function", name: "f" }], reasoning: { effort: "none" } };

		expect(buildThinkingDowngradedResponsesBody("responses", body)).toBeUndefined();
	});

	it("非 responses 调用类型不降级", () => {
		expect(buildThinkingDowngradedResponsesBody("chat", { tools: [{ type: "function", name: "f" }] })).toBeUndefined();
	});
});
