import type { Request } from "express";
import type { DrizzleDb } from "../core/db/Database";
import * as SpendTracker from "../spend/SpendTracker";
import { createVisionCapabilityAuditHook } from "./BuiltinCapabilityAudit";

describe("BuiltinCapabilityAudit", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("将每次识图模型调用作为同一身份和 Session 下的普通 Spend Log 请求记录", async () => {
		const auth = {
			api_key: "sk-test",
			token: "key-id",
			user_id: "user-id",
			team_id: "team-id",
		};
		const req = {
			auth: auth,
			body: { model: "deepseek-v4-flash", metadata: { trace_id: "session-1" } },
			headers: {},
			method: "POST",
			originalUrl: "/v1/chat/completions",
			url: "/v1/chat/completions",
		} as unknown as Request;
		const builtLog = { request_id: "child-log" } as never;
		const buildSpy = jest.spyOn(SpendTracker, "buildSpendLogFromRequest").mockResolvedValue(builtLog);
		const trackSpy = jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({
			status: "committed",
			requestId: "child-log",
			spend: 0.01,
		});
		const audit = createVisionCapabilityAuditHook({
			db: {} as DrizzleDb,
			req: req,
			parentRequestId: "parent-log",
		});

		const result = await audit!({
			capability: "vision",
			stage: "handler",
			callType: "acompletion",
			model: "gpt-5.4-mini",
			toolCallId: "call-vision",
			imageRefs: ["image_1"],
			question: "What error is visible?",
			detail: "high",
			messages: [{ role: "user", content: "private image request" }],
			startTime: new Date("2026-08-05T10:00:00.000Z"),
			endTime: new Date("2026-08-05T10:00:01.000Z"),
			response: {
				model: "gpt-5.4-mini",
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				_spendInfo: {
					modelId: "deployment-id",
					deploymentModel: "openai/gpt-5.4-mini",
					customLlmProvider: "openai",
				},
			},
		});

		expect(result.requestId).toMatch(/^[0-9a-f]{64}$/);
		expect(buildSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				req: req,
				auth: auth,
				requestId: result.requestId,
				callType: "acompletion",
				model: "gpt-5.4-mini",
				modelGroup: "gpt-5.4-mini",
				modelId: "deployment-id",
				deploymentModel: "openai/gpt-5.4-mini",
				proxyServerRequestUrl: "/internal/builtin-capabilities/vision",
				status: "success",
				requestTags: ["litellm:internal", "builtin:vision"],
				metadataOverrides: {
					internal_call: true,
					internal_call_type: "builtin_capability",
					builtin_capability: "vision",
					builtin_capability_stage: "handler",
					parent_request_id: "parent-log",
					tool_call_id: "call-vision",
					cache_namespace: "builtin:vision",
				},
			}),
		);
		expect(trackSpy).toHaveBeenCalledWith(expect.anything(), builtLog);

		const continuation = await audit!({
			capability: "vision",
			stage: "continuation",
			callType: "amessages",
			model: "deepseek-v4-flash",
			toolCallId: "call-vision",
			messages: [{ role: "user", content: "private vision result" }],
			requestBody: {
				model: "deepseek-v4-flash",
				max_tokens: 1024,
				messages: [{ role: "user", content: "private vision result" }],
			},
			startTime: new Date("2026-08-05T10:00:01.000Z"),
			endTime: new Date("2026-08-05T10:00:02.000Z"),
			response: {
				model: "deepseek-v4-flash",
				usage: { input_tokens: 20, output_tokens: 6 },
			},
		});

		expect(continuation.requestId).not.toBe(result.requestId);
		expect(buildSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				requestId: continuation.requestId,
				callType: "amessages",
				model: "deepseek-v4-flash",
				proxyServerRequestBody: expect.objectContaining({
					max_tokens: 1024,
					metadata: expect.objectContaining({
						internal_call_type: "builtin_capability",
						builtin_capability: "vision",
						builtin_capability_stage: "continuation",
						parent_request_id: "parent-log",
					}),
				}),
				metadataOverrides: expect.objectContaining({
					internal_call_type: "builtin_capability",
					builtin_capability: "vision",
					builtin_capability_stage: "continuation",
					parent_request_id: "parent-log",
				}),
			}),
		);
	});
});
