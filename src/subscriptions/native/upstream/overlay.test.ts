/**
 * 上游信息合并与请求侧上限校验的测试。
 *
 * 合并规则只有一条容易出错：上游只补空缺，配置/价目表已有值时不覆盖。请求侧规则
 * 同样只有一条：缓存里有上限且请求超限才拒绝，缓存缺失一律放行。
 */

import { buildEnrichedModelInfo } from "../../../proxy/modelGroupBuilder";
import { extractDeploymentCustomCost } from "../../../router/RouterSpendInfo";
import { applyUpstreamFills, buildUpstreamPayload } from "../../../proxy/upstreamModelOverlay";
import { assertWithinUpstreamOutputLimit, requestedMaxOutputTokens } from "./limits";
import type { UpstreamModelMetaRecord } from "./types";
import { registerUpstreamModelInfoService, resetUpstreamModelInfoService } from "./runtime";
import type { UpstreamModelInfoService } from "./service";
import type { SubscriptionSource } from "../types";

/**
 * 注册一个假服务：metadata() 供合并/计费读取，record() 供费用日志冻结抓取时间。
 * @param source - 来源
 * @param modelId - 模型
 * @param metadata - 归一化元信息
 */
function stubService(source: SubscriptionSource, modelId: string, metadata: Record<string, unknown>): void {
	const fetchedAt = new Date("2026-11-18T10:40:00.000Z");
	const record: UpstreamModelMetaRecord = {
		source: source,
		modelId: modelId,
		status: "ok",
		metadata: metadata as unknown as UpstreamModelMetaRecord["metadata"],
		fetchedAt: fetchedAt,
		expiresAt: new Date(fetchedAt.getTime() + 4 * 60 * 60_000),
	};
	const service = {
		metadata: (candidateSource: SubscriptionSource, candidateModel: string) =>
			candidateSource === source && candidateModel === modelId ? metadata : undefined,
		record: (candidateSource: SubscriptionSource, candidateModel: string) =>
			candidateSource === source && candidateModel === modelId ? record : undefined,
	};
	registerUpstreamModelInfoService(service as unknown as UpstreamModelInfoService);
}

describe("applyUpstreamFills", () => {
	it("只填空缺，不覆盖配置里的 0 与已有值", () => {
		const info: Record<string, unknown> = {
			max_input_tokens: 200_000,
			input_cost_per_token: 0,
			supports_vision: false,
		};
		const filled = applyUpstreamFills(info, {
			contextWindow: 1_000_000,
			maxOutputTokens: 131_072,
			inputCostPerToken: 1.4e-6,
			supportsVision: true,
			supportsTools: true,
		});
		expect(info["max_input_tokens"]).toBe(200_000);
		expect(info["input_cost_per_token"]).toBe(0);
		expect(info["supports_vision"]).toBe(false);
		expect(info["max_output_tokens"]).toBe(131_072);
		expect(info["supports_function_calling"]).toBe(true);
		expect(filled).toEqual(["max_output_tokens", "supports_function_calling"]);
	});

	it("没有上游元信息时不做任何修改", () => {
		const info: Record<string, unknown> = { max_input_tokens: null };
		expect(applyUpstreamFills(info, undefined)).toEqual([]);
		expect(info["max_input_tokens"]).toBeNull();
	});
});

describe("buildUpstreamPayload", () => {
	it("输出字段与过期标记，供界面提示使用", () => {
		const record: UpstreamModelMetaRecord = {
			source: "opencode-go",
			modelId: "glm-5.3",
			status: "ok",
			displayName: "GLM-5.3",
			metadata: { contextWindow: 1_000_000, maxOutputTokens: 131_072, inputCostPerToken: 1.4e-6 },
			fetchedAt: new Date("2026-11-18T00:00:00Z"),
			expiresAt: new Date("2026-11-18T04:00:00Z"),
		};
		const payload = buildUpstreamPayload({ source: "opencode-go", upstreamModel: "glm-5.3" }, record, ["max_output_tokens"]);
		expect(payload).toMatchObject({
			source: "opencode-go",
			upstream_model: "glm-5.3",
			status: "ok",
			stale: true,
			filled_fields: ["max_output_tokens"],
		});
		expect(payload.model_info).toMatchObject({
			max_input_tokens: 1_000_000,
			max_output_tokens: 131_072,
			input_cost_per_token: 1.4e-6,
		});
	});
});

describe("请求侧输出上限校验", () => {
	afterEach(() => {
		resetUpstreamModelInfoService();
	});

	it("识别各协议的输出上限字段", () => {
		expect(requestedMaxOutputTokens({ max_output_tokens: 1024 })).toBe(1024);
		expect(requestedMaxOutputTokens({ max_tokens: 2048 })).toBe(2048);
		expect(requestedMaxOutputTokens({ max_completion_tokens: 4096 })).toBe(4096);
		expect(requestedMaxOutputTokens({ generationConfig: { maxOutputTokens: 8192 } })).toBe(8192);
		expect(requestedMaxOutputTokens({})).toBeUndefined();
	});

	it("超过缓存中的上游上限时抛出可读的 400", () => {
		stubService("opencode-go", "glm-5.3", { maxOutputTokens: 131_072 });
		expect(() => assertWithinUpstreamOutputLimit("opencode-go", "glm-5.3", { max_output_tokens: 384_000 })).toThrow(/131072/);
		expect(() => assertWithinUpstreamOutputLimit("opencode-go", "glm-5.3", { max_output_tokens: 131_072 })).not.toThrow();
	});

	it("缓存里没有上限时放行", () => {
		stubService("opencode-go", "glm-5.3", {});
		expect(() => assertWithinUpstreamOutputLimit("opencode-go", "glm-5.3", { max_output_tokens: 384_000 })).not.toThrow();
		expect(() => assertWithinUpstreamOutputLimit("codex", "gpt-6.2-sol", { max_output_tokens: 384_000 })).not.toThrow();
	});
});

describe("buildEnrichedModelInfo 的上游合并", () => {
	afterEach(() => {
		resetUpstreamModelInfoService();
	});

	it("只在模型配置缺失时填上游值，并报告被填字段", () => {
		stubService("opencode-go", "glm-5.3", { contextWindow: 1_000_000, maxOutputTokens: 131_072, inputCostPerToken: 1.4e-6 });
		const deployment = {
			model_name: "glm",
			litellm_params: { model: "glm-5.3", custom_llm_provider: "opencode-go" },
			model_info: { max_output_tokens: 4096 },
		} as unknown as Parameters<typeof buildEnrichedModelInfo>[0];
		const out = { filledFields: [] as string[] };
		const info = buildEnrichedModelInfo(deployment, "glm", {}, undefined, out);
		expect(info["max_output_tokens"]).toBe(4096);
		expect(info["max_input_tokens"]).toBe(1_000_000);
		expect(info["input_cost_per_token"]).toBe(1.4e-6);
		expect(out.filledFields).toEqual(expect.arrayContaining(["max_input_tokens", "input_cost_per_token"]));
		expect(out.filledFields).not.toContain("max_output_tokens");
	});
});

describe("费用来源标记", () => {
	afterEach(() => {
		resetUpstreamModelInfoService();
	});

	/** 造一个订阅来源的 deployment。 */
	function deployment(modelInfo: Record<string, unknown>): Parameters<typeof extractDeploymentCustomCost>[0] {
		return {
			model_name: "unknown-model",
			litellm_params: { model: "unknown-model", custom_llm_provider: "opencode-go" },
			model_info: modelInfo,
		} as unknown as Parameters<typeof extractDeploymentCustomCost>[0];
	}

	it("配置缺价时把上游补的单价标出来，spend 日志据此标注费用来源", () => {
		stubService("opencode-go", "unknown-model", { inputCostPerToken: 1.4e-6, outputCostPerToken: 4.4e-6 });
		const cost = extractDeploymentCustomCost(deployment({}));
		expect(cost?.upstream_priced_fields).toEqual(["input_cost_per_token", "output_cost_per_token"]);
		// 单价与抓取时间随请求冻结，上游之后调价不会改写这行日志的解释。
		expect(cost?.upstream_catalog).toEqual({
			source: "opencode-go",
			upstream_model: "unknown-model",
			fetched_at: "2026-11-18T10:40:00.000Z",
			unit_prices: { input_cost_per_token: 1.4e-6, output_cost_per_token: 4.4e-6 },
		});
	});

	it("表单遗留的 0 单价不算配置，仍按上游价计费并标注来源", () => {
		stubService("opencode-go", "unknown-model", { inputCostPerToken: 1.4e-6, outputCostPerToken: 4.4e-6 });
		// 历史数据把留空单价存成了 0；若把 0 当配置，上游价永远进不来，费用恒为 0。
		const deploymentWithZero = {
			model_name: "unknown-model",
			litellm_params: {
				model: "unknown-model",
				custom_llm_provider: "opencode-go",
				input_cost_per_token: 0,
				output_cost_per_token: 0,
			},
			model_info: {},
		} as unknown as Parameters<typeof extractDeploymentCustomCost>[0];
		const cost = extractDeploymentCustomCost(deploymentWithZero);
		expect(cost?.input_cost_per_token).toBeCloseTo(1.4e-6, 12);
		expect(cost?.output_cost_per_token).toBeCloseTo(4.4e-6, 12);
		expect(cost?.upstream_priced_fields).toEqual(["input_cost_per_token", "output_cost_per_token"]);
	});

	it("价目表靠模糊匹配认识这个模型时，配置缺价仍以上游目录价为准", () => {
		// glm-5.3 会被 PRICE_TABLE 的 glm 族规则命中，但那是启发式，和上游目录价口径不同。
		stubService("opencode-go", "glm-5.3", { inputCostPerToken: 1.17e-6, outputCostPerToken: 4.6e-6 });
		const deploymentWithFamilyPrice = {
			model_name: "glm-5.3",
			litellm_params: { model: "glm-5.3", custom_llm_provider: "opencode-go" },
			model_info: {},
		} as unknown as Parameters<typeof extractDeploymentCustomCost>[0];
		const cost = extractDeploymentCustomCost(deploymentWithFamilyPrice);
		expect(cost?.input_cost_per_token).toBeCloseTo(1.17e-6, 12);
		expect(cost?.upstream_priced_fields).toEqual(["input_cost_per_token", "output_cost_per_token"]);
	});

	it("配置已给价时不标上游，哪怕上游也有价格", () => {
		stubService("opencode-go", "unknown-model", { inputCostPerToken: 1.4e-6, outputCostPerToken: 4.4e-6 });
		const cost = extractDeploymentCustomCost(deployment({ input_cost_per_token: 1e-6 }));
		expect(cost?.upstream_priced_fields).toEqual(["output_cost_per_token"]);
	});
});
