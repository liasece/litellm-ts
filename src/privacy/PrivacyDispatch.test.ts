/**
 * 发往上游前的脱敏调度：按最终 deployment 判定生效范围，并驱动上下文统计。
 */
import { applyPrivacyMaskingToUpstream, currentPrivacyRequest, PrivacyBlockedError, runWithPrivacyRequest } from "./PrivacyDispatch";
import { privacyScopeTargetOf } from "./PrivacyScope";
import { parsePrivacyMaskingSettings, type PrivacyMaskingSettings } from "./PrivacyConfig";
import { PrivacyContext } from "./PrivacyContext";
import type { Deployment } from "../types/router";

const EMAIL = "jansen@liasece.com";

/**
 * 伪造成最终选中的 deployment。
 * @param provider - custom_llm_provider
 * @param modelName - 模型组名
 * @param upstreamModel - 上游模型串
 */
function deployment(provider: string, modelName: string, upstreamModel: string): Deployment {
	return { model_name: modelName, litellm_params: { custom_llm_provider: provider, model: upstreamModel } } as Deployment;
}

const OPENCODE = deployment("cliproxy", "opencode-go/deepseek-v4.1-flash", "cliproxy/opencode-go/deepseek-v4.1-flash");
const DEEPSEEK = deployment("deepseek", "deepseek-v4-flash", "deepseek/deepseek-v4-flash");

/**
 * 在请求级状态里执行一次「发往上游前的脱敏」。
 * @param settings - 脱敏配置
 * @param target - 最终 deployment
 * @param body - 上游请求体
 * @param protocol - 请求体协议
 */
function dispatch(
	settings: PrivacyMaskingSettings,
	target: Deployment,
	body: Record<string, unknown>,
	protocol: "chat" | "anthropic" | "responses" | "embeddings" = "chat",
): { applied: boolean; body: Record<string, unknown>; context: PrivacyContext } {
	const context = new PrivacyContext({ settings: settings, customWords: [], configuredSecrets: [], rules: settings.rules });
	const state = { context: context, settings: settings, provider: "", model: "", masked: false };
	let applied = false;
	runWithPrivacyRequest(state, () => {
		applied = applyPrivacyMaskingToUpstream(body, privacyScopeTargetOf(target), protocol);
	});
	return { applied: applied, body: body, context: context };
}

describe("applyPrivacyMaskingToUpstream", () => {
	it("落在范围内的提供方会被替换，并记录实际去向", () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["opencode"] });
		const body = { model: "x", messages: [{ role: "user", content: `mail ${EMAIL}` }] };
		const result = dispatch(settings, OPENCODE, body);
		expect(result.applied).toBe(true);
		expect(JSON.stringify(body)).not.toContain(EMAIL);
		expect(JSON.stringify(body)).toContain("{{EMAIL_");
		expect(result.context.snapshotStats().occurrences).toBe(1);
		const state = currentPrivacyRequest();
		expect(state).toBeUndefined();
	});

	it("不在范围内的提供方原样放行", () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["opencode"] });
		const body = { model: "x", messages: [{ role: "user", content: `mail ${EMAIL}` }] };
		const result = dispatch(settings, DEEPSEEK, body);
		expect(result.applied).toBe(false);
		expect(JSON.stringify(body)).toContain(EMAIL);
		expect(result.context.snapshotStats().occurrences).toBe(0);
	});

	it("没有登记请求级状态时（例如图片端点）不处理", () => {
		const settings = parsePrivacyMaskingSettings({});
		const body = { messages: [{ role: "user", content: `mail ${EMAIL}` }] };
		expect(applyPrivacyMaskingToUpstream(body, privacyScopeTargetOf(OPENCODE), "chat")).toBe(false);
		expect(JSON.stringify(body)).toContain(EMAIL);
	});

	it("响应协议按上游请求体走 Responses 结构", () => {
		const settings = parsePrivacyMaskingSettings({});
		const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: `mail ${EMAIL}` }] }] };
		const result = dispatch(settings, OPENCODE, body, "responses");
		expect(result.applied).toBe(true);
		expect(JSON.stringify(body)).not.toContain(EMAIL);
	});

	it("命中 block 类型时抛出可被路由放行的错误", () => {
		const settings = parsePrivacyMaskingSettings({ kinds: { EMAIL: "block" } });
		const body = { messages: [{ role: "user", content: `mail ${EMAIL}` }] };
		expect(() => dispatch(settings, OPENCODE, body)).toThrow(PrivacyBlockedError);
		try {
			dispatch(settings, OPENCODE, { messages: [{ role: "user", content: `mail ${EMAIL}` }] });
		} catch (error) {
			expect(error).toBeInstanceOf(PrivacyBlockedError);
			expect((error as PrivacyBlockedError).kinds).toEqual(["EMAIL"]);
			expect((error as PrivacyBlockedError).statusCode).toBe(400);
			expect((error as PrivacyBlockedError).toErrorBody()).toEqual({
				error: {
					message: "Request rejected by privacy policy: EMAIL detected",
					type: "privacy_blocked",
					code: "privacy_blocked",
					param: null,
					kinds: ["EMAIL"],
				},
			});
		}
	});

	it("block 只对范围内的提供方生效", () => {
		const settings = parsePrivacyMaskingSettings({ kinds: { EMAIL: "block" }, providers: ["opencode"] });
		expect(() => dispatch(settings, DEEPSEEK, { messages: [{ role: "user", content: `mail ${EMAIL}` }] })).not.toThrow();
	});
});
