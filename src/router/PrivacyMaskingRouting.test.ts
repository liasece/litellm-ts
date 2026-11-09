/**
 * 脱敏在路由链里的位置：按最终选中的 deployment 判定生效范围，命中 block 时不重试、不 fallback。
 */
import { Router } from "./Router";
import { RoutingStrategyName, type Deployment } from "../types/router";
import { installMockFetch, okResponse } from "./RouterTestHelpers";
import { PrivacyBlockedError, runWithPrivacyRequest, type PrivacyRequestState } from "../privacy/PrivacyDispatch";
import { PrivacyContext } from "../privacy/PrivacyContext";
import { parsePrivacyMaskingSettings, privacySettingsService, type PrivacyMaskingSettings } from "../privacy/PrivacyConfig";

const EMAIL = "probe@jit-mail.com";

let mockFetch: jest.Mock;

/**
 * 构造带 fallback 的部署集合：两个模型组都走 deepseek provider。
 */
function makeRouter(): Router {
	const primary: Deployment = {
		model_name: "primary-model",
		litellm_params: { model: "deepseek/deepseek-v4-flash", custom_llm_provider: "deepseek", api_key: "provider-key" },
		model_info: { id: "primary" },
	};
	const fallback: Deployment = {
		model_name: "fallback-model",
		litellm_params: { model: "deepseek/deepseek-v4-flash", custom_llm_provider: "deepseek", api_key: "provider-key" },
		model_info: { id: "fallback" },
	};
	return new Router({
		model_list: [primary, fallback],
		routing_strategy: RoutingStrategyName.SimpleShuffle,
		num_retries: 0,
		fallbacks: [{ "primary-model": ["fallback-model"] }],
	});
}

/**
 * 在请求级脱敏状态里执行路由调用。
 * @param settings - 脱敏配置
 * @param run - 路由调用
 */
function withPrivacy<T>(settings: PrivacyMaskingSettings, run: () => Promise<T>): { result: Promise<T>; state: PrivacyRequestState } {
	const context = new PrivacyContext({ settings: settings, customWords: [], configuredSecrets: [], rules: settings.rules });
	const state: PrivacyRequestState = { context: context, settings: settings, provider: "", model: "", masked: false };
	return { result: runWithPrivacyRequest(state, run), state: state };
}

/**
 * 成功响应体。
 */
function okBody(): Response {
	return okResponse({
		id: "chat-1",
		object: "chat.completion",
		created: 1,
		model: "deepseek-v4-flash",
		choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
	});
}

/**
 * 取当前这一跳发往上游的请求体。
 * @param callIndex - 第几次 fetch
 */
function upstreamBody(callIndex = 0): Record<string, unknown> {
	const init = mockFetch.mock.calls[callIndex]?.[1] as { body?: string } | undefined;
	return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
	mockFetch = installMockFetch();
	privacySettingsService.setSnapshot(parsePrivacyMaskingSettings({}));
});

describe("路由链里的脱敏调度", () => {
	it("范围内：真正发往上游的请求体已是占位符", async () => {
		mockFetch.mockResolvedValueOnce(okBody());
		const settings = parsePrivacyMaskingSettings({ providers: ["deepseek"] });
		const { result, state } = withPrivacy(settings, () =>
			makeRouter().completion("primary-model", [{ role: "user", content: `mail ${EMAIL}` }]),
		);
		await result;
		const body = JSON.stringify(upstreamBody());
		expect(body).not.toContain(EMAIL);
		expect(body).toContain("{{EMAIL_");
		expect(state.masked).toBe(true);
		expect(state.provider).toBe("deepseek");
		expect(state.model).toBe("primary-model");
	});

	it("范围外：上游照旧收到原文", async () => {
		mockFetch.mockResolvedValueOnce(okBody());
		const settings = parsePrivacyMaskingSettings({ providers: ["opencode"] });
		const { result, state } = withPrivacy(settings, () =>
			makeRouter().completion("primary-model", [{ role: "user", content: `mail ${EMAIL}` }]),
		);
		await result;
		expect(JSON.stringify(upstreamBody())).toContain(EMAIL);
		expect(state.masked).toBe(false);
	});

	it("命中 block：直接拒绝，不发起上游请求，也不进入 fallback", async () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["deepseek"], kinds: { EMAIL: "block" } });
		const { result } = withPrivacy(settings, () =>
			makeRouter().completion("primary-model", [{ role: "user", content: `mail ${EMAIL}` }]),
		);
		await expect(result).rejects.toBeInstanceOf(PrivacyBlockedError);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("block 的响应体保持 privacy_blocked 结构", async () => {
		const settings = parsePrivacyMaskingSettings({ kinds: { EMAIL: "block" } });
		const { result } = withPrivacy(settings, () =>
			makeRouter().completion("primary-model", [{ role: "user", content: `mail ${EMAIL}` }]),
		);
		await expect(result).rejects.toMatchObject({
			statusCode: 400,
			errorType: "privacy_blocked",
			toErrorBody: expect.any(Function) as unknown,
		});
	});
});
