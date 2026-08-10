import type { Request } from "express";
import { ImageController } from "./ImageEndpoint";
import * as AuthChecks from "../auth/AuthChecks";
import * as SpendTracker from "../spend/SpendTracker";
import { attachUpstreamLogContext } from "../router/UpstreamLogContext";

jest.mock("../core/config", () => ({ getConfig: () => ({ generalSettings: {} }) }));

describe("ImageController spend lifecycle", () => {
	const auth = { api_key: "sk-test", user_id: "user-1" } as never;
	const request = {
		auth: auth,
		headers: {},
		body: {},
		method: "POST",
		url: "/v1/images/generations",
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as Request;
	const router = {
		imageGeneration: jest.fn(),
		getDeployments: () => [
			{
				model_name: "image-test-group",
				litellm_params: {
					model: "provider/image-test-model",
					input_cost_per_token: 0.001,
					output_cost_per_token: 0.002,
				},
			},
		],
		getFallbacks: () => ({}),
	};

	beforeEach(() => {
		router.imageGeneration.mockReset();
		jest.spyOn(AuthChecks, "runCommonChecks").mockImplementation(() => undefined);
		jest.spyOn(SpendTracker, "getOrCreateSpendRequestId").mockReturnValue("request-1");
		jest.spyOn(SpendTracker, "buildSpendReservationScopes").mockReturnValue([]);
		jest.spyOn(SpendTracker, "estimateSpendReservation").mockReturnValue(0.01);
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "request-1",
			reserved: 0.01,
			actual: null,
		});
		jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({ status: "committed", requestId: "request-1", spend: 0 });
		router.imageGeneration.mockResolvedValue({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
	});

	afterEach(() => jest.restoreAllMocks());

	it("无硬预算时调用上游并 await 成功账务", async () => {
		const result = await new ImageController(router as never, {} as never).generate({ model: "image-model", prompt: "draw" }, request);

		expect(result).toEqual(expect.objectContaining({ usage: expect.any(Object) }));
		expect(AuthChecks.runCommonChecks).toHaveBeenCalledWith(auth, "image-model");
		expect(SpendTracker.reserveSpend).not.toHaveBeenCalled();
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ request_id: "request-1" }));
	});

	it("provider 成功后的账务错误不会被改写为失败日志", async () => {
		const accountingError = new Error("accounting unavailable");
		jest.spyOn(SpendTracker, "trackSpendLog").mockRejectedValueOnce(accountingError);

		await expect(
			new ImageController(router as never, {} as never).generate({ model: "image-model", prompt: "draw" }, request),
		).rejects.toBe(accountingError);
		expect(router.imageGeneration).toHaveBeenCalledTimes(1);
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledTimes(1);
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "success" }));
	});

	it("provider 失败后 SpendLog 与 reservation release 的 503 均不覆盖原错误", async () => {
		const providerError = Object.assign(new Error("provider failed"), { statusCode: 429 });
		router.imageGeneration.mockRejectedValueOnce(providerError);
		jest.spyOn(SpendTracker, "trackSpendLog").mockRejectedValueOnce(Object.assign(new Error("track unavailable"), { statusCode: 503 }));
		jest.spyOn(SpendTracker, "releaseSpend").mockRejectedValueOnce(
			Object.assign(new Error("release unavailable"), { statusCode: 503 }),
		);

		await expect(
			new ImageController(router as never, {} as never).generate({ model: "image-model", prompt: "draw" }, request),
		).rejects.toBe(providerError);
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ request_id: "request-1", status: "failure" }),
		);
		expect(SpendTracker.releaseSpend).toHaveBeenCalledWith(expect.anything(), "request-1");
	});

	it("成功账务携带 Router 结果上的上游日志上下文", async () => {
		const upstreamLogContext = {
			request: { url: "http://provider/v1/images/generations", method: "POST", headers: {}, body: {} },
			response: { status_code: 200, headers: {} },
		};
		const buildSpy = jest.spyOn(SpendTracker, "buildSpendLogFromRequest");
		router.imageGeneration.mockResolvedValueOnce(
			attachUpstreamLogContext({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, upstreamLogContext),
		);

		await new ImageController(router as never, {} as never).generate({ model: "image-model", prompt: "draw" }, request);

		expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ upstreamLogContext: upstreamLogContext }));
	});

	it("失败账务携带 provider 错误上的上游日志上下文", async () => {
		const upstreamLogContext = {
			request: { url: "http://provider/v1/images/generations", method: "POST", headers: {}, body: {} },
		};
		const buildSpy = jest.spyOn(SpendTracker, "buildSpendLogFromRequest");
		router.imageGeneration.mockRejectedValueOnce(attachUpstreamLogContext(new Error("provider failed"), upstreamLogContext));

		await expect(
			new ImageController(router as never, {} as never).generate({ model: "image-model", prompt: "draw" }, request),
		).rejects.toThrow("provider failed");
		expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ upstreamLogContext: upstreamLogContext }));
	});

	it("硬预算下无法可靠上界估算时在上游前返回 503", async () => {
		jest.spyOn(SpendTracker, "buildSpendReservationScopes").mockReturnValueOnce([{ kind: "key", id: "sk-test" }]);

		await expect(
			new ImageController(router as never, {} as never).generate({ model: "image-model", prompt: "draw" }, request),
		).rejects.toMatchObject({ statusCode: 503 });
		expect(SpendTracker.reserveSpend).not.toHaveBeenCalled();
		expect(router.imageGeneration).not.toHaveBeenCalled();
	});
});
