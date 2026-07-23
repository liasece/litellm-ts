import type { Request } from "express";
import { AudioController } from "./AudioEndpoint";
import * as AuthChecks from "../auth/AuthChecks";
import * as SpendTracker from "../spend/SpendTracker";

jest.mock("../core/config", () => ({ getConfig: () => ({ generalSettings: {} }) }));

describe("AudioController spend lifecycle", () => {
	const auth = { api_key: "sk-test", user_id: "user-1" } as never;
	const request = {
		auth: auth,
		headers: {},
		body: {},
		method: "POST",
		url: "/v1/audio/speech",
		socket: { remoteAddress: "127.0.0.1" },
	} as unknown as Request;
	const router = {
		completion: jest.fn(),
		getDeployments: () => [
			{
				model_name: "audio-test-group",
				litellm_params: {
					model: "provider/audio-test-model",
					input_cost_per_token: 0.001,
					output_cost_per_token: 0.002,
				},
			},
		],
		getFallbacks: () => ({}),
	};

	beforeEach(() => {
		router.completion.mockReset();
		jest.spyOn(AuthChecks, "runCommonChecks").mockImplementation(() => undefined);
		jest.spyOn(SpendTracker, "getOrCreateSpendRequestId").mockReturnValue("audio-request-1");
		jest.spyOn(SpendTracker, "buildSpendReservationScopes").mockReturnValue([]);
		jest.spyOn(SpendTracker, "estimateSpendReservation").mockReturnValue(0.01);
		jest.spyOn(SpendTracker, "reserveSpend").mockResolvedValue({
			status: "reserved",
			requestId: "audio-request-1",
			reserved: 0.01,
			actual: null,
		});
		jest.spyOn(SpendTracker, "trackSpendLog").mockResolvedValue({ status: "committed", requestId: "audio-request-1", spend: 0 });
		router.completion.mockResolvedValue({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
	});

	afterEach(() => jest.restoreAllMocks());

	it.each([
		["speech", { model: "tts-model", input: "hello", voice: "alloy" }],
		["transcribe", { model: "asr-model", file: "audio" }],
	] as const)("%s 无硬预算时执行上游并记录花费", async (method, body) => {
		const controller = new AudioController(router as never, {} as never);
		await controller[method](body as never, request);

		expect(AuthChecks.runCommonChecks).toHaveBeenCalledWith(auth, body.model);
		expect(SpendTracker.reserveSpend).not.toHaveBeenCalled();
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ request_id: "audio-request-1" }),
		);
	});

	it("provider 成功后的账务错误不会被改写为失败日志", async () => {
		const accountingError = new Error("accounting unavailable");
		jest.spyOn(SpendTracker, "trackSpendLog").mockRejectedValueOnce(accountingError);

		await expect(
			new AudioController(router as never, {} as never).speech({ model: "tts-model", input: "hello", voice: "alloy" }, request),
		).rejects.toBe(accountingError);
		expect(router.completion).toHaveBeenCalledTimes(1);
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledTimes(1);
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "success" }));
	});

	it("上游失败后原子提交失败日志并释放预留", async () => {
		router.completion.mockRejectedValueOnce(new Error("provider failed"));

		await expect(
			new AudioController(router as never, {} as never).speech({ model: "tts-model", input: "hello", voice: "alloy" }, request),
		).rejects.toThrow("provider failed");
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ request_id: "audio-request-1", status: "failure" }),
		);
	});

	it("失败日志提交失败时保留原始 provider 错误", async () => {
		const providerError = new Error("provider failed");
		router.completion.mockRejectedValueOnce(providerError);
		jest.spyOn(SpendTracker, "trackSpendLog").mockRejectedValueOnce(new Error("accounting unavailable"));

		await expect(
			new AudioController(router as never, {} as never).speech({ model: "tts-model", input: "hello", voice: "alloy" }, request),
		).rejects.toBe(providerError);
		expect(SpendTracker.trackSpendLog).toHaveBeenCalledTimes(1);
	});

	it("硬预算下无法可靠上界估算时在上游前返回 503", async () => {
		jest.spyOn(SpendTracker, "buildSpendReservationScopes").mockReturnValueOnce([{ kind: "key", id: "sk-test" }]);

		await expect(
			new AudioController(router as never, {} as never).speech({ model: "tts-model", input: "hello", voice: "alloy" }, request),
		).rejects.toMatchObject({ statusCode: 503 });
		expect(SpendTracker.reserveSpend).not.toHaveBeenCalled();
		expect(router.completion).not.toHaveBeenCalled();
	});
});
