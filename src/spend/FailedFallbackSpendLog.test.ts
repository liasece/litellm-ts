import type { Request } from "express";
import { Router } from "../router/Router";
import { RoutingStrategyName } from "../types/router";
import { runWithUpstreamExchangeScope } from "../router/UpstreamExchange";
import { buildSpendLogFromRequest } from "./SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";

const request = { body: { model: "requested" }, headers: {}, ip: "127.0.0.1", method: "POST", originalUrl: "/v1/chat/completions" } as unknown as Request;

afterEach(() => jest.restoreAllMocks());

describe("failed Router fallback spend attribution", () => {
	it.each(["http", "network", "unavailable-final-route"])("keeps the last actual deployment after %s", async (failure) => {
		const fetchMock = jest
			.spyOn(global, "fetch")
			.mockResolvedValueOnce(new Response('{"error":"initial unavailable"}', { status: 503 }));
		if (failure === "network") {
			fetchMock.mockRejectedValueOnce(new TypeError("final connection failed"));
		} else {
			fetchMock.mockResolvedValueOnce(new Response('{"error":"final overloaded"}', { status: 529 }));
		}
		const router = new Router({
			model_list: [
				{
					model_name: "requested",
					litellm_params: { model: "openai/initial", api_key: "test-key" },
					model_info: { id: "initial-dep" },
				},
				{
					model_name: "fallback",
					litellm_params: { model: "MiniMax-M3.1-Flash", custom_llm_provider: "minimax", api_key: "test-key" },
					model_info: { id: "final-dep" },
				},
			],
			fallbacks: [{ requested: ["fallback"] }, ...(failure === "unavailable-final-route" ? [{ fallback: ["unavailable"] }] : [])],
			num_retries: 0,
			routing_strategy: RoutingStrategyName.SimpleShuffle,
		});
		const log = await runWithUpstreamExchangeScope(async () => {
			let terminalError: unknown;
			try {
				await router.completion("requested", [{ role: "user", content: "hello" }]);
			} catch (error) {
				terminalError = error;
			}
			expect(terminalError).toBeDefined();
			return buildSpendLogFromRequest({
				req: request,
				callType: CallType.ACompletion,
				model: "requested",
				modelId: "stale-initial-dep",
				deploymentModel: "openai/initial",
				error: terminalError,
				startTime: new Date(),
				endTime: new Date(),
			});
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(log).toMatchObject({
			status: SpendLogStatus.Failure,
			model: "MiniMax-M3.1-Flash",
			model_group: "requested",
			model_id: "final-dep",
			custom_llm_provider: "minimax",
		});
		expect(log.metadata?.error_information).toMatchObject({ upstream_url: expect.any(String) });
		expect(log.proxy_server_request).not.toHaveProperty("spendInfo");
	});

	it("does not attribute a request with no upstream attempt to another request's deployment", async () => {
		const log = await runWithUpstreamExchangeScope(() =>
			buildSpendLogFromRequest({
				req: request,
				callType: CallType.ACompletion,
				model: "requested",
				error: new Error("no deployment"),
				startTime: new Date(),
				endTime: new Date(),
			}),
		);
		expect(log.model).toBe("requested");
		expect(log.model_id).toBeUndefined();
	});
});
