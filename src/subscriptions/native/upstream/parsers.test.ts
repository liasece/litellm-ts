/**
 * 七家上游解析器的字段映射测试。
 *
 * 每个 fixture 都取自真实上游响应（见 docs 里的探测记录）或官方文档示例；这里验证
 * 的是「不同上游的不同字段名/单位能不能落到同一套归一化字段」，以及上游没给的字段
 * 必须保持 undefined，不能被本地静态目录的值冒充。
 */

import { antigravityUpstreamAdapter } from "./antigravity";
import { claudeUpstreamAdapter } from "./claude";
import { codexUpstreamAdapter } from "./codex";
import { commandcodeUpstreamAdapter } from "./commandcode";
import { kimiUpstreamAdapter } from "./kimi";
import { opencodeUpstreamAdapter } from "./opencode";
import { xaiUpstreamAdapter } from "./xai";
import { extractEntries } from "./normalize";

describe("上游模型元信息解析器", () => {
	it("OpenCode：limit/cost/capabilities 归一化，价格从百万 token 换算为 per-token", () => {
		const [entry] = [
			{
				id: "glm-5.3",
				name: "GLM-5.3",
				description: "Flagship GLM model",
				family: "glm",
				canonical_id: "zhipuai/glm-5.3",
				release_date: "2026-08-14",
				limit: { context: 1_000_000, output: 131_072 },
				cost: { text: { input: { price: 1.4, cache: { read: 0.26 } }, output: { price: 4.4 } } },
				capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ["low", "high", "max"] }, structured_output: true },
				modalities: { input: ["text"], output: ["text"] },
			},
		];
		const metadata = opencodeUpstreamAdapter.parse([entry]).get("glm-5.3");
		expect(metadata).toMatchObject({
			displayName: "GLM-5.3",
			contextWindow: 1_000_000,
			maxOutputTokens: 131_072,
			inputCostPerToken: 1.4e-6,
			outputCostPerToken: 4.4e-6,
			cacheReadCostPerToken: 2.6e-7,
			supportsTools: true,
			supportsReasoning: true,
			supportsStructuredOutput: true,
			supportsVision: false,
			reasoningLevels: ["low", "high", "max"],
			family: "glm",
			canonicalId: "zhipuai/glm-5.3",
		});
	});

	it("CommandCode：只有 context_length，输出上限与价格保持缺省", () => {
		const metadata = commandcodeUpstreamAdapter
			.parse([{ id: "gpt-6-luna", name: "GPT-6 Luna", context_length: 400_000, supported_endpoints: ["responses"] }])
			.get("gpt-6-luna");
		expect(metadata).toEqual({ displayName: "GPT-6 Luna", contextWindow: 400_000 });
		expect(metadata?.maxOutputTokens).toBeUndefined();
		expect(metadata?.inputCostPerToken).toBeUndefined();
	});

	it("Codex：context_window 与 reasoning levels；不臆造输出上限", () => {
		const metadata = codexUpstreamAdapter
			.parse([
				{
					slug: "gpt-6.2-sol",
					display_name: "GPT-6.2-Sol",
					context_window: 500_000,
					input_modalities: ["text", "image", "audio"],
					supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }],
				},
			])
			.get("gpt-6.2-sol");
		expect(metadata?.contextWindow).toBe(500_000);
		expect(metadata?.supportsVision).toBe(true);
		expect(metadata?.reasoningLevels).toEqual(["low", "medium"]);
		expect(metadata?.maxOutputTokens).toBeUndefined();
	});

	it("Claude：/v1/models 的可空限额由公开目录 runtime 补齐", () => {
		const entries = [
			// 公开 catalog（先合并，limits 可靠）
			{ id: "claude-opus-5-5", name: "Opus 5.5", runtime: { max_input_tokens: 1_000_000, max_output_tokens: 128_000, family: "opus" } },
			// /v1/models（display_name 与能力；max_* 为 null）
			{
				id: "claude-opus-5-5",
				type: "model",
				display_name: "Opus 5.5 (subscription)",
				max_input_tokens: null,
				max_tokens: null,
				capabilities: { image_input: { supported: true }, thinking: { supported: true }, structured_outputs: { supported: true } },
			},
		];
		const metadata = claudeUpstreamAdapter.parse(entries).get("claude-opus-5-5");
		expect(metadata?.contextWindow).toBe(1_000_000);
		expect(metadata?.maxOutputTokens).toBe(128_000);
		expect(metadata?.supportsVision).toBe(true);
		expect(metadata?.displayName).toBe("Opus 5.5 (subscription)");
	});

	it("Kimi：context_length 与图片/推理能力", () => {
		const metadata = kimiUpstreamAdapter
			.parse([{ id: "kimi-for-coding", context_length: 262_144, supports_reasoning: true, supports_image_in: true, display_name: "k2.6-code-preview" }])
			.get("kimi-for-coding");
		expect(metadata).toMatchObject({
			displayName: "k2.6-code-preview",
			contextWindow: 262_144,
			supportsReasoning: true,
			supportsVision: true,
		});
		expect(metadata?.maxOutputTokens).toBeUndefined();
	});

	it("Antigravity：{models:{id:…}} 映射为条目，maxTokens/maxOutputTokens 生效", () => {
		const entries = extractEntries(
			{
				models: {
					"gemini-3-flash": {
						displayName: "Gemini 3 Flash",
						supportsImages: true,
						supportsThinking: true,
						supportsVideo: true,
						maxTokens: 1_048_576,
						maxOutputTokens: 65_536,
					},
				},
			},
			["models"],
		);
		const metadata = antigravityUpstreamAdapter.parse(entries).get("gemini-3-flash");
		expect(metadata).toMatchObject({
			displayName: "Gemini 3 Flash",
			contextWindow: 1_048_576,
			maxOutputTokens: 65_536,
			supportsVision: true,
			supportsReasoning: true,
		});
	});

	it("xAI：CLI proxy 的 context_window 与 reasoning_efforts 对象数组", () => {
		const metadata = xaiUpstreamAdapter
			.parse([
				{
					id: "grok-4.7",
					name: "Grok 4.7",
					context_window: 500_000,
					reasoning_efforts: [{ value: "high" }, { id: "low" }],
					owned_by: "xAI",
				},
			])
			.get("grok-4.7");
		expect(metadata?.contextWindow).toBe(500_000);
		expect(metadata?.reasoningLevels).toEqual(["high", "low"]);
		expect(metadata?.maxOutputTokens).toBeUndefined();
	});

	it("xAI：官方 API 价格单位是 USD 分 / 100M token", () => {
		const metadata = xaiUpstreamAdapter
			.parse([
				{
					id: "grok-420-reasoning",
					context_length: 256_000,
					prompt_text_token_price: 20_000,
					cached_prompt_text_token_price: 2_000,
					completion_text_token_price: 80_000,
					capabilities: { reasoning_effort: ["low", "medium", "high", "xhigh"] },
				},
			])
			.get("grok-420-reasoning");
		expect(metadata?.inputCostPerToken).toBeCloseTo(2e-6, 12);
		expect(metadata?.cacheReadCostPerToken).toBeCloseTo(2e-7, 12);
		expect(metadata?.outputCostPerToken).toBeCloseTo(8e-6, 12);
		expect(metadata?.reasoningLevels).toEqual(["low", "medium", "high", "xhigh"]);
	});
});
