/**
 * 生效范围判定：只按最终 deployment 判定，配置项按包含匹配。
 */
import { isPrivacyScopeMatch, privacyScopeTargetOf } from "./PrivacyScope";
import { parsePrivacyMaskingSettings } from "./PrivacyConfig";
import type { Deployment } from "../types/router";

/**
 * 伪造成最终选中的 deployment。
 * @param provider - custom_llm_provider
 * @param modelName - 模型组名
 * @param upstreamModel - 上游模型串
 */
function deployment(provider: string, modelName: string, upstreamModel: string): Deployment {
	return { model_name: modelName, litellm_params: { custom_llm_provider: provider, model: upstreamModel } } as Deployment;
}

const OPEN_CODE = deployment("cliproxy", "opencode-go/deepseek-v4.1-flash", "cliproxy/opencode-go/deepseek-v4.1-flash");
const GPT = deployment("cliproxy", "gpt-5.4", "cliproxy/gpt-5.4");
const DEEPSEEK = deployment("deepseek", "deepseek-v4-flash", "deepseek/deepseek-v4-flash");

describe("privacyScopeTargetOf", () => {
	it("取出 provider、模型组名与上游模型串", () => {
		expect(privacyScopeTargetOf(OPEN_CODE)).toEqual({
			provider: "cliproxy",
			modelName: "opencode-go/deepseek-v4.1-flash",
			upstreamModel: "cliproxy/opencode-go/deepseek-v4.1-flash",
		});
	});
});

describe("isPrivacyScopeMatch", () => {
	it("两个列表都为空时对所有提供方生效", () => {
		const settings = parsePrivacyMaskingSettings({});
		for (const target of [OPEN_CODE, GPT, DEEPSEEK]) {
			expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(target))).toBe(true);
		}
	});

	it("提供方写 opencode 时只命中 opencode 的模型", () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["opencode"] });
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(OPEN_CODE))).toBe(true);
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(GPT))).toBe(false);
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(DEEPSEEK))).toBe(false);
	});

	it("提供方写 cliproxy 时命中该提供方的全部模型", () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["cliproxy"] });
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(OPEN_CODE))).toBe(true);
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(GPT))).toBe(true);
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(DEEPSEEK))).toBe(false);
	});

	it("模型列表按上游模型串与模型组名匹配，支持通配符写法", () => {
		const byName = parsePrivacyMaskingSettings({ models: ["opencode-go/*"] });
		expect(isPrivacyScopeMatch(byName, privacyScopeTargetOf(OPEN_CODE))).toBe(true);
		expect(isPrivacyScopeMatch(byName, privacyScopeTargetOf(GPT))).toBe(false);
		const byUpstream = parsePrivacyMaskingSettings({ models: ["deepseek-v4-flash"] });
		expect(isPrivacyScopeMatch(byUpstream, privacyScopeTargetOf(DEEPSEEK))).toBe(true);
	});

	it("两个列表都非空时取交集", () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["cliproxy"], models: ["opencode"] });
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(OPEN_CODE))).toBe(true);
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(GPT))).toBe(false);
	});

	it("匹配大小写不敏感，空条目忽略", () => {
		const settings = parsePrivacyMaskingSettings({ providers: ["  OpenCode  "] });
		expect(isPrivacyScopeMatch(settings, privacyScopeTargetOf(OPEN_CODE))).toBe(true);
		const blank = parsePrivacyMaskingSettings({ providers: ["   "] });
		expect(isPrivacyScopeMatch(blank, privacyScopeTargetOf(GPT))).toBe(true);
	});
});

it("keeps a historical provider and model filter on its original subscription when providers share an upstream model", () => {
	const settings = parsePrivacyMaskingSettings({providers:["cliproxy"],models:["cliproxy/commandcode/vendor/model"]});
	const target = {modelName:"team-alias",upstreamModel:"vendor/model"};
	expect(isPrivacyScopeMatch(settings,{...target,provider:"commandcode"})).toBe(true);
	expect(isPrivacyScopeMatch(settings,{...target,provider:"opencode-go"})).toBe(false);
});
