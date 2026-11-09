import { isSubscriptionProvider } from "../subscriptions/SubscriptionProviders";
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
import { modelCostMapService } from "./ModelCostMapService";

const logger = createModuleLogger("Cost");

// ========== 价格表 ==========

/** 单模型价格（每 1M tokens） */
interface ModelPrice {
	readonly inputPerMillion: number;
	readonly outputPerMillion: number;
	/** PY: model-level cache creation cost (per 1M tokens), defaults to inputPerMillion if not set */
	readonly cacheCreationPerMillion?: number;
	/** PY: model-level cache read cost (per 1M tokens), defaults to inputPerMillion if not set */
	readonly cacheReadPerMillion?: number;
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

/** Service tier 枚举（对齐 PY `_get_service_tier_cost_key`） */
export enum ServiceTier {
	Standard = "standard",
	Batch = "batch",
	Premium = "premium",
	Flex = "flex",
	Priority = "priority",
}

/**
 * ModelCostMap 中 tier-specific 单价字段的后缀（PY `_get_service_tier_cost_key`）。
 * - Flex / Priority / Premium 对应 `input_cost_per_token_${suffix}` / `output_cost_per_token_${suffix}`。
 * - Batch 走 batches 字段并对 output 额外乘 0.5。
 *
 * 提取为 enum 是为了消除"按字符串拼字段名"的裸字符串漂移：
 * tierMap / above_200k 相关字段必须用本枚举派生，避免直接写 "flex"/"priority"。
 */
export enum ModelCostTierSuffix {
	Flex = "flex",
	Priority = "priority",
	Batches = "batches",
}

/**
 * DIFF-007: above_200k 阶梯定价阈值（PY utils.py:5709-5736）。
 * 当 `effectivePrompt > ABOVE_200K_TOKENS_THRESHOLD` 时切换到 `${prefix}_above_200k_tokens` 字段。
 */
const ABOVE_200K_TOKENS_THRESHOLD = 200_000;

/** above_200k 阶梯字段后缀（与 ABOVE_200K_TOKENS_THRESHOLD 共用，禁止裸写） */
const ABOVE_200K_FIELD_SUFFIX = "above_200k_tokens";

/**
 * GAP (DIFF-COST-01): 移除硬编码 tierMultiplier。
 *
 * PY `cost_calculator.py:140-159 _get_service_tier_cost_key` 实际行为：
 *   - tier === "flex"     → 查 `model_cost[model]?.input_cost_per_token_flex` /
 *                              `output_cost_per_token_flex` 字段；未配置回退到 standard
 *   - tier === "priority" → 查 `input_cost_per_token_priority` /
 *                              `output_cost_per_token_priority`；未配置回退到 standard
 *   - 其他 tier（batch/premium）→ 回退到 standard 字段
 *   - batch 单独走 `output_cost_per_token_batches / 2`（gap：暂未实现）
 *
 * 硬编码 2.0 乘数是错误前提——PY 中 "premium" 实际是 "priority" 的别名但**不会**加价。
 *
 * 现 `costPerToken` 接受 `modelCostMap` 透传，service_tier 为 flex/priority 时优先查
 * `${prefix}_${tier}` 后缀键；缺省时回退到 standard（1.0×，无乘数）。
 */

/** 每百万的分母 */
const PER_MILLION = 1_000_000;

/** 计算结果 */
export interface CostResult {
	/** 缓存创建 + 缓存读取输入 token 费用 */
	readonly cacheInputCost: number;
	/** 输入 token 费用 */
	readonly inputCost: number;
	/** 输出 token 费用 */
	readonly outputCost: number;
	/** 总费用（缓存输入 + 输入 + 输出） */
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
 * GAP: PY `_select_model_name_for_cost_calc` 支持 provider/region/model 三段式
 * (如 `bedrock/us-west-2/anthropic.claude-v2`)。当 model 是三段（含 region）时
 * 剥离 region 段做匹配；当是两段时剥离 provider；当只有一段时直接用 lower model name。
 * @param model
 */
function _stripRouterAndRegionPrefix(model: string): string[] {
	// 返回一个候选列表（按优先级），调用方依次尝试
	const candidates: string[] = [model];
	const parts = model.split("/");
	if (parts.length === 3) {
		// provider/region/model — 去掉 region 段（PY: 优先 bedrock/anthropic.claude-v2）
		candidates.push(`${parts[0]}/${parts[2]}`);
		candidates.push(parts[2]!);
	}
	if (parts.length === 2) {
		candidates.push(parts[1]!);
	}
	return candidates;
}

/**
 * 提取 model 名称的候选匹配列表（单次 _stripRouterAndRegionPrefix 调用）。
 * 集中原本在 lookupPrice / costPerToken 多处重复调用的逻辑。
 * @param model
 */
function _candidatesFor(model: string): string[] {
	const separator = model.indexOf("/");
	const provider = model.slice(0, separator);
	if (separator > 0 && isSubscriptionProvider(provider)) {
		const previous = "cliproxy/" + (provider === "commandcode" || provider === "opencode-go" ? model : model.slice(separator + 1));
		return [...new Set([model, ..._stripRouterAndRegionPrefix(previous), ..._stripRouterAndRegionPrefix(model)])];
	}
	return _stripRouterAndRegionPrefix(model);
}

/**
 * 根据模型名称解析价格配置
 * GAP: 现支持 provider/region/model 三段式（如 bedrock/us-west-2/claude）。
 * DIFF-COST-02: 新增 `modelCostMap` 透传 — 对齐 PY `_get_model_info` 优先从
 * `litellm.model_cost` 字典查，再回退到内置 PRICE_TABLE。
 * @param model - 完整模型名称（如 "deepseek-v4-flash/xxx"）
 * @param modelCostMap - 可选 litellm.model_cost 透传（PY: litellm.model_cost[model]）
 * @returns 匹配的价格，找不到时返回 undefined
 */
function lookupCostMapEntry(model: string, modelCostMap?: Record<string, ModelCostMapEntry>): ModelCostMapEntry | undefined {
	const candidates = _candidatesFor(model);
	if (modelCostMap) {
		for (const candidate of candidates) {
			const entry = modelCostMap[candidate];
			if (entry !== undefined) {
				return entry;
			}
		}
	}
	const snapshotMap = modelCostMapService.getSnapshot().map;
	for (const candidate of candidates) {
		const entry = snapshotMap[candidate];
		if (entry !== undefined) {
			return entry as ModelCostMapEntry;
		}
	}
	return undefined;
}

function lookupPrice(model: string, modelCostMap?: Record<string, ModelCostMapEntry>): ModelPrice | undefined {
	const costMapEntry = lookupCostMapEntry(model, modelCostMap);
	if (costMapEntry !== undefined) {
		return {
			inputPerMillion: (costMapEntry.input_cost_per_token ?? 0) * PER_MILLION,
			outputPerMillion: (costMapEntry.output_cost_per_token ?? 0) * PER_MILLION,
			cacheCreationPerMillion:
				costMapEntry.cache_creation_input_token_cost === undefined
					? undefined
					: costMapEntry.cache_creation_input_token_cost * PER_MILLION,
			cacheReadPerMillion:
				costMapEntry.cache_read_input_token_cost === undefined ? undefined : costMapEntry.cache_read_input_token_cost * PER_MILLION,
		};
	}
	for (const candidate of _candidatesFor(model)) {
		const lower = candidate.toLowerCase();
		for (const entry of PRICE_TABLE) {
			if (lower.includes(entry.pattern)) {
				return entry.price;
			}
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
 * @param modelCostMap - 可选 litellm.model_cost 透传
 */
export function lookupModelCostPerToken(
	model: string,
	modelCostMap?: Record<string, ModelCostMapEntry>,
): { input_cost_per_token: number; output_cost_per_token: number } | undefined {
	const price = lookupPrice(model, modelCostMap);
	if (price === undefined) {
		return undefined;
	}
	return {
		input_cost_per_token: price.inputPerMillion / PER_MILLION,
		output_cost_per_token: price.outputPerMillion / PER_MILLION,
	};
}

/**
 * GAP: PY `cost_calculator.py` 支持 deployment 级 `custom_cost_per_token`
 * 覆盖（litellm_params 上配置 input/output/cache_creation/cache_read 单价）。
 * TS 之前不支持，现在透传到 costPerToken 走优先级最高的定价路径。
 */
export interface CustomCostPerToken {
	/** 输入 token 单价（每 token） */
	readonly input_cost_per_token?: number;
	/** 输出 token 单价（每 token） */
	readonly output_cost_per_token?: number;
	/** cache write 单价（每 token），覆盖模型级 cacheCreationPerMillion */
	readonly cache_creation_input_token_cost?: number;
	/** cache read 单价（每 token），覆盖模型级 cacheReadPerMillion */
	readonly cache_read_input_token_cost?: number;
	/**
	 * 峰谷定价配置。放在这里是为了让已透传 customCostPerToken 的端点自动获得峰谷能力，
	 * 无需再为每个端点单独传参。
	 */
	readonly peak_pricing?: PeakPricingConfig;
}

/**
 * 计算单次请求的费用
 * GAP: 新增 `customCostPerToken` 参数 — 对齐 PY deployment 级 per-token override。
 * 优先级（高→低）：customCostPerToken > 模型级 PRICE_TABLE > 硬编码 cache flat rate。
 * 单位：customCostPerToken 是 per-token (不是 per 1M)，PY 同样。
 * GAP (COST-001): 模型在 PRICE_TABLE 和 llmux 列表里都未匹配时，**return {0,0,0}**，
 * 对齐 PY cost_calculator.py:2076-2077 `if not model_info: return 0.0, 0.0` 静默行为。
 * 调用方（SpendTracker）无需再 try/catch；未知模型计费为 0 + logger.warn 留痕。
 * GAP (COST-002): 新增 `service_tier` 参数 — 对齐 PY `_get_service_tier_cost_key`。
 * - "batch"   → input/output batch 半价（output_cost_per_token_batches / 2 等）
 * - "premium" → input/output premium 价
 * - "flex"    → input/output flex 价
 * - "standard"（默认）→ 标准 input/output 价
 *
 * DIFF-COST-01: service_tier 不再用硬编码乘数；改用 modelCostMap 联动
 * - "flex"     → 查 modelCostMap[model]?.input_cost_per_token_flex /
 * output_cost_per_token_flex；未配置回退 standard
 * - "priority" → 查 modelCostMap[model]?.input_cost_per_token_priority /
 * output_cost_per_token_priority；未配置回退 standard
 * - "premium"  → priority 别名；缺省不乘 2
 * - "batch"    → 输出走 output_cost_per_token_batches / 2（暂未实现→回退 standard）
 * - 其他/缺省  → standard（无乘数）
 *
 * DIFF-COST-02: 新增 `modelCostMap` 透传参数（来自 Router.config.model_cost_map）
 *
 * DIFF-003: 新增 `reasoningTokens` / `cachedTokens` 参数 — 对齐 PY
 * `cost_calculator.py:2076-2105 cost_per_token`，PY 在 input/output cost 计算前先扣除
 * cache_creation/cache_read tokens（input 侧）以及 reasoning_tokens（output 侧），
 * 否则 reasoning 模型 output cost 会偏高（reasoning_tokens 被双重计费）。
 * 参数语义：
 * - `reasoningTokens`: completion_tokens_details.reasoning_tokens（从 output 中扣除，
 * 按 reasoning 单价或直接不计费，TS 当前按 0 单价处理 = 完全不计费，对齐 PY 行为）
 * - `cachedTokens`: prompt_tokens_details.cached_tokens 二级路径（与 cacheReadTokens 二选一，
 * 调用方可通过 SpendTracker.calculateAndSetCost 透传完整 prompt_tokens_details）
 *
 * DIFF-007: 新增 above_200k tiered pricing — 对齐 PY `utils.py:5709-5736`。
 * 当 `prompt_tokens > 200_000` 且 modelCostMap 提供 `${prefix}_above_200k_tokens` 后缀字段时，
 * 切换到阶梯定价。涉及四个字段：
 * - input_cost_per_token_above_200k_tokens
 * - output_cost_per_token_above_200k_tokens
 * - cache_creation_input_token_cost_above_200k_tokens
 * - cache_read_input_token_cost_above_200k_tokens
 * @param model - 模型名称
 * @param promptTokens - 提示 token 数（含缓存写入）
 * @param completionTokens - 补全 token 数
 * @param cacheCreationTokens - 缓存创建 token 数（可选，额外按缓存写入价计费）
 * @param cacheReadTokens - 缓存读取 token 数（可选，额外按缓存读取价计费）
 * @param options - 可选配置：skipProviderTokenCounting + customCostPerToken + service_tier + modelCostMap + reasoningTokens
 * @returns CostResult — 输入/输出/总费用
 */
/**
 * 模型峰谷定价配置（写在 deployment 的 model_info.peak_pricing 或 litellm_params.peak_pricing）。
 *
 * 基础价（input_cost_per_token 等）按“空闲时段”配置，峰时按 multiplier 上浮。
 * 对齐 DeepSeek 官方口径：高峰为北京时间周一至周五 9:00-12:00、14:00-18:00，
 * 其余时段（含周末与法定节假日）为空闲时段，空闲价为高峰价的一半。
 */
export interface PeakPricingConfig {
	/** IANA 时区，缺省 Asia/Shanghai */
	readonly timezone?: string;
	/** 峰时窗口；days 为 ISO 星期（1=周一 … 7=周日），start/end 为时区内 HH:mm，左闭右开 */
	readonly windows: ReadonlyArray<{ readonly days: number[]; readonly start: string; readonly end: string }>;
	/** 峰时相对基础价（空闲价）的倍数，例如 2 */
	readonly multiplier: number;
	/** 法定节假日（YYYY-MM-DD，按时区判定），全天按空闲价；缺省不排除 */
	readonly holidays?: readonly string[];
}

const ISO_WEEKDAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * HH:mm 转当日分钟数。
 * @param value - 时钟文本
 */
function clockMinutes(value: string): number {
	const [hours, minutes] = value.split(":");
	return Number(hours) * 60 + Number(minutes);
}

/**
 * 解析请求时刻对应的价格系数：峰时返回 multiplier，其余返回 1。
 * 配置缺失或非法时一律返回 1（按基础价计费），避免计费因配置笔误整体失效。
 * @param config - 峰谷配置
 * @param at - 请求开始时刻；缺省取当前时间
 */
export function resolvePeakMultiplier(config: PeakPricingConfig | undefined, at: Date | undefined): number {
	if (config === undefined || !(config.multiplier > 1) || !Array.isArray(config.windows) || config.windows.length === 0) {
		return 1;
	}
	const instant = at ?? new Date();
	const timeZone = config.timezone ?? "Asia/Shanghai";
	let parts: Intl.DateTimeFormatPart[];
	try {
		parts = new Intl.DateTimeFormat("en-US", {
			timeZone: timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		}).formatToParts(instant);
	} catch {
		return 1;
	}
	const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
	const weekday = ISO_WEEKDAYS[pick("weekday")];
	if (weekday === undefined) {
		return 1;
	}
	if (config.holidays !== undefined && config.holidays.includes(`${pick("year")}-${pick("month")}-${pick("day")}`)) {
		return 1;
	}
	const minutes = Number(pick("hour")) * 60 + Number(pick("minute"));
	const inPeakWindow = config.windows.some(
		(window) => window.days.includes(weekday) && minutes >= clockMinutes(window.start) && minutes < clockMinutes(window.end),
	);
	return inPeakWindow ? config.multiplier : 1;
}

/**
 * 计算一次请求的分项与总费用。
 * 价格优先级：部署级 customCostPerToken > 模型价格表 > 内置 PRICE_TABLE；
 * 命中峰谷配置且请求时刻处于峰时窗口时，输入/输出/缓存单价统一上浮。
 * @param model - 模型名
 * @param promptTokens - 输入 token 数
 * @param completionTokens - 输出 token 数
 * @param cacheCreationTokens - 缓存写入 token 数
 * @param cacheReadTokens - 缓存读取 token 数
 * @param options - 可选计费参数
 */
export function costPerToken(
	model: string,
	promptTokens: number,
	completionTokens: number,
	cacheCreationTokens = 0,
	cacheReadTokens = 0,
	options?:
		| {
				/** 跳过上游 token 统计，按字符数启发式估算 */
				skipProviderTokenCounting?: boolean;
				/** 部署级 per-token 价格（含可选峰谷配置） */
				customCostPerToken?: CustomCostPerToken;
				/** 服务等级，决定价格表字段后缀 */
				service_tier?: ServiceTier;
				/** 模型价格表快照 */
				modelCostMap?: Record<string, ModelCostMapEntry>;
				/** DIFF-003: completion_tokens_details.reasoning_tokens — 从 output 中扣除 */
				reasoningTokens?: number;
				/** 模型峰谷配置；命中峰时按 multiplier 上浮基础价 */
				peakPricing?: PeakPricingConfig;
				/** 请求开始时刻，用于判定峰谷；缺省取当前时间 */
				at?: Date;
		  }
		| boolean,
): CostResult {
	// 向后兼容：原签名最后一个参数是 `skipProviderTokenCounting?: boolean`
	const skipProviderTokenCounting = typeof options === "boolean" ? options : options?.skipProviderTokenCounting;
	const customCostPerToken = typeof options === "object" ? options?.customCostPerToken : undefined;
	const serviceTier: ServiceTier = typeof options === "object" ? (options?.service_tier ?? ServiceTier.Standard) : ServiceTier.Standard;
	const modelCostMap = typeof options === "object" ? options?.modelCostMap : undefined;
	// DIFF-003: 从 options 取 reasoningTokens
	const reasoningTokens = typeof options === "object" ? (options?.reasoningTokens ?? 0) : 0;
	// 峰谷：基础价按空闲时段配置，峰时统一上浮（含输入、输出与缓存价）
	const peakMultiplier =
		typeof options === "object"
			? resolvePeakMultiplier(options?.peakPricing ?? options?.customCostPerToken?.peak_pricing, options?.at)
			: 1;
	// When skipping provider token counting, use heuristic (chars/4) for token estimation
	const effectivePrompt = skipProviderTokenCounting ? Math.max(1, Math.round(promptTokens / 4)) : promptTokens;
	const effectiveCompletion = skipProviderTokenCounting ? Math.max(1, Math.round(completionTokens / 4)) : completionTokens;

	// GAP: 优先级 1 — customCostPerToken（部署级 per-token override，含 model_info 价格）。
	// 必须先于 llmux 零计费判定：PY 无 llmux 特判，配置显式价格（即使 0.0）即为真实计费
	// （生产 model_info 给 gpt-5.6-* 等订阅模型也配置了价格，spend 需按价实算）。
	// UI 新建的 DB 模型会把 input/output_cost_per_token 默认写成 0，这会把模型价格表里
	// 已知的价格整体抹平（如 minimax/MiniMax-M3 的 919 条请求 spend=0）。仅当自定义价格
	// "全为 0"且价格表能给出非零价格时回退价格表并留痕一次；其余情况保留显式 0 计费
	//（自建 / 订阅模型的故意零计费）。
	const customPrices = [
		customCostPerToken?.input_cost_per_token,
		customCostPerToken?.output_cost_per_token,
		customCostPerToken?.cache_creation_input_token_cost,
		customCostPerToken?.cache_read_input_token_cost,
	].filter((value): value is number => value !== undefined);
	const customIsAllZero = customPrices.length > 0 && customPrices.every((value) => value === 0);
	const zeroFallbackEntry = customIsAllZero ? lookupCostMapEntry(model, modelCostMap) : undefined;
	const zeroFallbackHasPrice =
		zeroFallbackEntry !== undefined &&
		((zeroFallbackEntry.input_cost_per_token ?? 0) > 0 || (zeroFallbackEntry.output_cost_per_token ?? 0) > 0);
	if (customIsAllZero && zeroFallbackHasPrice) {
		warnZeroPriceFallback(model);
	}
	if (customPrices.length > 0 && !(customIsAllZero && zeroFallbackHasPrice)) {
		const inputPerToken = (customCostPerToken?.input_cost_per_token ?? 0) * peakMultiplier;
		const outputPerToken = (customCostPerToken?.output_cost_per_token ?? 0) * peakMultiplier;
		const cacheCreatePerToken = (customCostPerToken?.cache_creation_input_token_cost ?? 0) * peakMultiplier;
		const cacheReadPerToken = (customCostPerToken?.cache_read_input_token_cost ?? 0) * peakMultiplier;
		const nonCachePrompt = Math.max(0, effectivePrompt - cacheCreationTokens - cacheReadTokens);
		// DIFF-003: 从 output 扣除 reasoning_tokens（PY: completion_tokens -= reasoning_tokens）
		const nonReasoningCompletion = Math.max(0, effectiveCompletion - reasoningTokens);
		const inputCost = nonCachePrompt * inputPerToken;
		const outputCost = nonReasoningCompletion * outputPerToken;
		const cacheCreationCost = cacheCreationTokens * cacheCreatePerToken;
		const cacheReadCost = cacheReadTokens * cacheReadPerToken;
		const cacheInputCost = cacheCreationCost + cacheReadCost;
		const totalCost = inputCost + outputCost + cacheInputCost;
		return { cacheInputCost: cacheInputCost, inputCost: inputCost, outputCost: outputCost, totalCost: totalCost };
	}

	const costMapEntry = lookupCostMapEntry(model, modelCostMap);

	// DIFF-COST-01: service_tier 联动 modelCostMap 字段
	// tier=flex     → input_cost_per_token_flex     / output_cost_per_token_flex
	// tier=priority → input_cost_per_token_priority / output_cost_per_token_priority
	// tier=batch    → input_cost_per_token_batches / output_cost_per_token_batches (DIFF-COST-02)
	// premium 是 priority 别名
	// 类型安全映射：值用 ModelCostTierSuffix enum，避免裸字符串漂移
	const tierMap: { [key in ServiceTier]?: ModelCostTierSuffix } = {
		[ServiceTier.Flex]: ModelCostTierSuffix.Flex,
		[ServiceTier.Priority]: ModelCostTierSuffix.Priority,
		[ServiceTier.Premium]: ModelCostTierSuffix.Priority,
		[ServiceTier.Batch]: ModelCostTierSuffix.Batches,
	};
	const tierSuffix = tierMap[serviceTier];
	let inputPerMillion = 0;
	let outputPerMillion = 0;
	let usedTierKey = false;
	// DIFF-007: 检测 prompt_tokens 超过阶梯阈值时优先 above_200k 阶梯定价
	const useAbove200k = effectivePrompt > ABOVE_200K_TOKENS_THRESHOLD;
	// DIFF-007: 用于 cache token 后续计费的 above_200k 切换
	let cacheCreationOverridePerMillion: number | undefined;
	let cacheReadOverridePerMillion: number | undefined;
	// DIFF-COST-01: 即使 modelCostMap 未提供，batch tier 也应使用 standard 单价作为兜底
	// (PY: batch 走 output_cost_per_token_batches / 2，但缺省时仍走 standard)
	if (tierSuffix && costMapEntry) {
		const entry = costMapEntry as Record<string, number | undefined>;
		const tierInput = entry[`input_cost_per_token_${tierSuffix}`];
		const tierOutput = entry[`output_cost_per_token_${tierSuffix}`];
		if (typeof tierInput === "number" || typeof tierOutput === "number") {
			inputPerMillion = (tierInput ?? 0) * PER_MILLION;
			outputPerMillion = (tierOutput ?? 0) * PER_MILLION;
			usedTierKey = true;
		}
	}
	// DIFF-COST-01: batch tier 但 modelCostMap 未提供 batches 字段时，
	// 不强制回退 standard — 直接用 lookupPrice 流程（已包含 standard 兜底）。
	// outputMultiplier 仍为 1.0（仅 usedTierKey=true 才 * 0.5）。
	if (!usedTierKey) {
		// DIFF-007: 优先尝试 above_200k tiered pricing（仅当 prompt_tokens > 阈值 且 modelCostMap 命中时）
		let above200kHit = false;
		if (useAbove200k && costMapEntry) {
			const entry = costMapEntry as Record<string, number | undefined>;
			const aboveInput = entry[`input_cost_per_token_${ABOVE_200K_FIELD_SUFFIX}`];
			const aboveOutput = entry[`output_cost_per_token_${ABOVE_200K_FIELD_SUFFIX}`];
			const aboveCacheCreation = entry[`cache_creation_input_token_cost_${ABOVE_200K_FIELD_SUFFIX}`];
			const aboveCacheRead = entry[`cache_read_input_token_cost_${ABOVE_200K_FIELD_SUFFIX}`];
			if (typeof aboveInput === "number" || typeof aboveOutput === "number") {
				inputPerMillion = (aboveInput ?? entry["input_cost_per_token"] ?? 0) * PER_MILLION;
				outputPerMillion = (aboveOutput ?? entry["output_cost_per_token"] ?? 0) * PER_MILLION;
				if (typeof aboveCacheCreation === "number") {
					cacheCreationOverridePerMillion = aboveCacheCreation * PER_MILLION;
				}
				if (typeof aboveCacheRead === "number") {
					cacheReadOverridePerMillion = aboveCacheRead * PER_MILLION;
				}
				above200kHit = true;
			}
		}
		if (!above200kHit) {
			const price = lookupPrice(model, modelCostMap);
			if (price === undefined) {
				// llmux 模型仅在统一 snapshot 与显式 override 都未命中时沿用订阅零计费兼容行为。
				if (isLlmuxModel(model)) {
					return { cacheInputCost: 0, inputCost: 0, outputCost: 0, totalCost: 0 };
				}
				// GAP (COST-001): 对齐 PY cost_calculator.py:2076-2077 — 未知模型返回 0,0,0 静默处理
				// 之前 throw 让 SpendTracker 等调用方手动 catch → 仍写 0；PY 直接 return 0,0,0。
				// 现改为 return 0,0,0 + logger.warn 提示配置缺口，避免上游重复 try/catch 噪音。
				// 告警必须带上候选名，否则只看到裸逻辑名（如 MiniMax-M3）无法判断该给哪个
				// deployment 补价 —— 生产上正是因为缺这条线索，MiniMax 漏记持续了三个月。
				logger.warn(`未找到模型价格: ${model}，按 0 计费`, {
					model: model,
					candidates: _candidatesFor(model),
					customCostProvided: customPrices.length > 0,
				});
				return { cacheInputCost: 0, inputCost: 0, outputCost: 0, totalCost: 0 };
			}
			inputPerMillion = price.inputPerMillion;
			outputPerMillion = price.outputPerMillion;
		}
	}

	// PY: subtract cached tokens from prompt_tokens before calculating input cost (cost_calculator.py:2088-2101)
	const nonCachePrompt = Math.max(0, effectivePrompt - cacheCreationTokens - cacheReadTokens);
	// DIFF-003: 从 output 扣除 reasoning_tokens（PY: completion_tokens -= reasoning_tokens）
	// 注：PY 把 reasoning_tokens 视为输出的一部分但不计费（output_cost_per_token_reasoning 默认 0），
	// TS 当前实现按 0 单价处理 = 完全不计费，与 PY 默认行为一致。
	const nonReasoningCompletion = Math.max(0, effectiveCompletion - reasoningTokens);
	// DIFF-COST-01: 移除硬编码 tierMultiplier，缺省时 input/output 直接用 lookup 得到的单价。
	const inputCost = (nonCachePrompt / PER_MILLION) * inputPerMillion * peakMultiplier;
	// DIFF-COST-01: batch tier 输出 * 0.5
	// PY `cost_calculator.py:140-159 _get_service_tier_cost_key`：batch 走
	//   output_cost_per_token_batches / 2（即 output_cost_per_token_batches 字段再除以 2）。
	// TS 把"再除以 2"折叠到 multiplier；仅当 modelCostMap 提供 batches 字段（usedTierKey=true）时启用，
	// 缺省（回退 standard）时 output 不应用 0.5 折扣。直接内联 batch+usedTierKey 判定，避免
	// 多余的 isBatchTier 中间变量。
	const outputMultiplier = serviceTier === ServiceTier.Batch && usedTierKey ? 0.5 : 1.0;
	const outputCost = (nonReasoningCompletion / PER_MILLION) * outputPerMillion * outputMultiplier * peakMultiplier;

	// GAP: 模型级动态 cache 定价（cost_calculator.py 从 model_cost_map 读取
	//   cache_read_input_token_cost / cache_creation_input_token_cost 字段）。
	// 优先级（高→低）：above_200k 覆盖 → 模型表 cacheCreationPerMillion → 硬编码 flat rate
	// 如需 deployment 级 override，请使用 customCostPerToken 参数（上面已处理）。
	// DIFF-007: above_200k 命中时优先用 cacheCreationOverridePerMillion / cacheReadOverridePerMillion
	const cacheCreationPerMillion =
		cacheCreationOverridePerMillion ??
		(costMapEntry?.cache_creation_input_token_cost === undefined
			? CACHE_CREATION_INPUT_COST_PER_MILLION
			: costMapEntry.cache_creation_input_token_cost * PER_MILLION);
	const cacheReadPerMillion =
		cacheReadOverridePerMillion ??
		(costMapEntry?.cache_read_input_token_cost === undefined
			? CACHE_READ_INPUT_COST_PER_MILLION
			: costMapEntry.cache_read_input_token_cost * PER_MILLION);
	const cacheCreationCost = (cacheCreationTokens / PER_MILLION) * cacheCreationPerMillion * peakMultiplier;
	const cacheReadCost = (cacheReadTokens / PER_MILLION) * cacheReadPerMillion * peakMultiplier;

	const cacheInputCost = cacheCreationCost + cacheReadCost;
	const totalCost = inputCost + outputCost + cacheInputCost;

	return { cacheInputCost: cacheInputCost, inputCost: inputCost, outputCost: outputCost, totalCost: totalCost };
}

/**
 * ModelCostMap entry（DIFF-COST-01/DIFF-COST-02/DIFF-007）
 * 对齐 PY litellm.model_cost[model] 字典的子集字段。
 *   - input_cost_per_token / output_cost_per_token: 标准 tier
 *   - input_cost_per_token_flex / output_cost_per_token_flex: flex tier
 *   - input_cost_per_token_priority / output_cost_per_token_priority: priority/premium tier
 *   - input_cost_per_token_above_200k_tokens / output_cost_per_token_above_200k_tokens:
 *     PY utils.py:5709-5736 阶梯定价（prompt_tokens > 200k 时切换）
 */
export interface ModelCostMapEntry {
	/** 标准 tier 输入单价（每 token，PY litellm.model_cost[model].input_cost_per_token） */
	readonly input_cost_per_token?: number;
	/** 标准 tier 输出单价（每 token，PY litellm.model_cost[model].output_cost_per_token） */
	readonly output_cost_per_token?: number;

	/** 标准 cache write 单价（每 token） */
	readonly cache_creation_input_token_cost?: number;

	/** 标准 cache read 单价（每 token） */
	readonly cache_read_input_token_cost?: number;

	/** flex tier 输入单价（每 token，service_tier=flex 时优先使用） */
	readonly input_cost_per_token_flex?: number;

	/** flex tier 输出单价（每 token，service_tier=flex 时优先使用） */
	readonly output_cost_per_token_flex?: number;

	/** priority tier 输入单价（每 token，service_tier=priority/premium 时优先使用） */
	readonly input_cost_per_token_priority?: number;

	/** priority tier 输出单价（每 token，service_tier=priority/premium 时优先使用） */
	readonly output_cost_per_token_priority?: number;

	/**
	 * DIFF-COST-02: batch tier 定价（PY: cost_calculator.py:735-759）。
	 * 当 service_tier=batch 时，input/output 走本字段；额外 batch 输出 * 0.5 折扣。
	 */
	readonly input_cost_per_token_batches?: number;

	/**
	 * DIFF-COST-02: batch tier 输出定价。
	 */
	readonly output_cost_per_token_batches?: number;

	/**
	 * DIFF-007: above_200k 阶梯定价（PY utils.py:5709-5736）。
	 * 当 prompt_tokens > 200_000 时，input/output/cache 单价切换到本字段。
	 */
	readonly input_cost_per_token_above_200k_tokens?: number;

	/**
	 * DIFF-007: above_200k 阶梯定价 — output。
	 */
	readonly output_cost_per_token_above_200k_tokens?: number;

	/**
	 * DIFF-007: above_200k 阶梯定价 — cache write。
	 */
	readonly cache_creation_input_token_cost_above_200k_tokens?: number;

	/**
	 * DIFF-007: above_200k 阶梯定价 — cache read。
	 */
	readonly cache_read_input_token_cost_above_200k_tokens?: number;
}

/** 价格全为 0 的部署回退价格表时只告警一次，避免逐请求刷屏。 */
const zeroPriceFallbackWarned = new Set<string>();

/**
 * 记录「部署价格全为 0 已回退价格表」的配置缺口。
 * @param model - 本次计费的模型名
 */
function warnZeroPriceFallback(model: string): void {
	if (zeroPriceFallbackWarned.has(model)) {
		return;
	}
	zeroPriceFallbackWarned.add(model);
	logger.warn(`模型配置价格全为 0，已回退模型价格表: ${model}`);
}
