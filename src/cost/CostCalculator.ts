/**
 * Token 费用计算器
 *
 * 使用硬编码的价格数据计算模型 token 费用。
 * Claude/OpenAI 通过 llmux 订阅计费，cost 为 0。
 * 完整价格表上线后切换为动态配置。
 *
 * 价格参考（每 1M tokens）：
 * ┌─────────────────┬──────────┬───────────┐
 * │ 模型             │ 输入      │ 输出       │
 * ├─────────────────┼──────────┼───────────┤
 * │ DeepSeek V4     │ $0.50    │ $1.00     │
 * │ DeepSeek V4 Pro │ $1.75    │ $3.50     │
 * │ GLM-5.1         │ $1.17    │ $4.08     │
 * │ GLM-5-Turbo     │ $1.02    │ $3.79     │
 * │ GLM-4.7         │ $0.58    │ $2.92     │
 * │ MiMo V2.5 Pro   │ $1.02    │ $3.06     │
 * │ MiMo V2.5       │ $0.41    │ $2.04     │
 * └─────────────────┴──────────┴───────────┘
 */

import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Cost");

// ========== 价格表 ==========

/** 单模型价格（每 1M tokens） */
interface ModelPrice {
	readonly inputPerMillion: number;
	readonly outputPerMillion: number;
}

/** 名称模式 → 价格映射（按优先级降序排列，优先精确匹配） */
const PRICE_TABLE: ReadonlyArray<{ readonly pattern: string; readonly price: ModelPrice }> = [
	{ pattern: "deepseek-v4-pro", price: { inputPerMillion: 1.75, outputPerMillion: 3.5 } },
	{ pattern: "deepseek-v4-flash", price: { inputPerMillion: 0.5, outputPerMillion: 1.0 } },
	{ pattern: "deepseek-v4", price: { inputPerMillion: 1.75, outputPerMillion: 3.5 } }, // fallback to Pro
	{ pattern: "glm-5-turbo", price: { inputPerMillion: 1.02, outputPerMillion: 3.79 } },
	{ pattern: "glm-5.1", price: { inputPerMillion: 1.17, outputPerMillion: 4.08 } },
	{ pattern: "glm-51", price: { inputPerMillion: 1.17, outputPerMillion: 4.08 } },
	{ pattern: "glm-5", price: { inputPerMillion: 1.17, outputPerMillion: 4.08 } }, // fallback to 5.1
	{ pattern: "glm-4.7", price: { inputPerMillion: 0.58, outputPerMillion: 2.92 } },
	{ pattern: "glm-47", price: { inputPerMillion: 0.58, outputPerMillion: 2.92 } },
	{ pattern: "glm-4", price: { inputPerMillion: 0.58, outputPerMillion: 2.92 } }, // fallback to 4.7
	{ pattern: "mimo-v2.5-pro", price: { inputPerMillion: 1.02, outputPerMillion: 3.06 } },
	{ pattern: "mimo-v25-pro", price: { inputPerMillion: 1.02, outputPerMillion: 3.06 } },
	{ pattern: "mimo-v2.5", price: { inputPerMillion: 0.41, outputPerMillion: 2.04 } },
	{ pattern: "mimo-v25", price: { inputPerMillion: 0.41, outputPerMillion: 2.04 } },
];

/** 缓存写入价格（每 1M tokens） */
const CACHE_CREATION_INPUT_COST_PER_MILLION = 0.5;

/** 缓存读取价格（每 1M tokens） */
const CACHE_READ_INPUT_COST_PER_MILLION = 0.05;

/** llmux 前缀 — 走 llmux 的模型 cost 为 0 */
const LLMUX_MODEL_PREFIXES = ["claude-", "gpt-", "o1-", "o3-"];

/** 每百万的分母 */
const PER_MILLION = 1_000_000;

/** 计算结果 */
export interface CostResult {
	/** 输入 token 费用 */
	readonly inputCost: number;
	/** 输出 token 费用 */
	readonly outputCost: number;
	/** 总费用（输入 + 输出） */
	readonly totalCost: number;
}

/**
 * 是否通过 llmux 订阅（cost 为 0）
 * @param model
 */
function isLlmuxModel(model: string): boolean {
	// 移除 provider 前缀（如 anthropic/claude-... → claude-...）
	const base = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
	return LLMUX_MODEL_PREFIXES.some((prefix) => base.startsWith(prefix));
}

/**
 * 根据模型名称解析价格配置
 * @param model - 完整模型名称（如 "deepseek-v4-flash/xxx"）
 * @returns 匹配的价格，找不到时返回 undefined
 */
function lookupPrice(model: string): ModelPrice | undefined {
	const lower = model.toLowerCase();
	for (const entry of PRICE_TABLE) {
		if (lower.includes(entry.pattern)) {
			return entry.price;
		}
	}
	return undefined;
}

/**
 * Per-token cost lookup from built-in price table.
 * Aligns with PY litellm.model_cost lookup for models in the local price table.
 * Returns input/output cost per token (not per million), or undefined if model not found.
 * Used by costBasedRouting as fallback when user-provided model_cost_map misses.
 * @param model
 */
export function lookupModelCostPerToken(model: string): { input_cost_per_token: number; output_cost_per_token: number } | undefined {
	const price = lookupPrice(model);
	if (price === undefined) {
		return undefined;
	}
	return {
		input_cost_per_token: price.inputPerMillion / PER_MILLION,
		output_cost_per_token: price.outputPerMillion / PER_MILLION,
	};
}

/**
 * 计算单次请求的费用
 * @param model - 模型名称
 * @param promptTokens - 提示 token 数（含缓存写入）
 * @param completionTokens - 补全 token 数
 * @param cacheCreationTokens - 缓存创建 token 数（可选，额外按缓存写入价计费）
 * @param cacheReadTokens - 缓存读取 token 数（可选，额外按缓存读取价计费）
 * @param skipProviderTokenCounting - 若为 true，将传入的 token 数视为字符数（除以 4 估算 token 数）代替 provider 报告值
 * @returns CostResult — 输入/输出/总费用
 */
export function costPerToken(
	model: string,
	promptTokens: number,
	completionTokens: number,
	cacheCreationTokens = 0,
	cacheReadTokens = 0,
	skipProviderTokenCounting?: boolean,
): CostResult {
	// When skipping provider token counting, use heuristic (chars/4) for token estimation
	const effectivePrompt = skipProviderTokenCounting ? Math.max(1, Math.round(promptTokens / 4)) : promptTokens;
	const effectiveCompletion = skipProviderTokenCounting ? Math.max(1, Math.round(completionTokens / 4)) : completionTokens;

	// llmux 模型不产生费用
	if (isLlmuxModel(model)) {
		return { inputCost: 0, outputCost: 0, totalCost: 0 };
	}

	const price = lookupPrice(model);
	if (price === undefined) {
		logger.warn(`未找到模型价格: ${model}，返回 0 费用`);
		return { inputCost: 0, outputCost: 0, totalCost: 0 };
	}

	// 基础输入费用：promptTokens 中包含缓存写入部分
	const inputCost = (effectivePrompt / PER_MILLION) * price.inputPerMillion;

	// 输出费用
	const outputCost = (effectiveCompletion / PER_MILLION) * price.outputPerMillion;

	// 缓存费用（额外）
	const cacheCreationCost = (cacheCreationTokens / PER_MILLION) * CACHE_CREATION_INPUT_COST_PER_MILLION;
	const cacheReadCost = (cacheReadTokens / PER_MILLION) * CACHE_READ_INPUT_COST_PER_MILLION;

	const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;

	return { inputCost: inputCost, outputCost: outputCost, totalCost: totalCost };
}
