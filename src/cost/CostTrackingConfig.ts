import { isSubscriptionProvider } from "../subscriptions/SubscriptionProviders";
/**
 * 费用折扣与保证金配置
 *
 * 对齐 Python `litellm_settings.cost_discount_config` / `cost_margin_config`
 * （cost_calculator.py 的 _apply_cost_discount / _apply_cost_margin）。
 *
 * 应用顺序：基础 token 费用 → provider 折扣 → provider 保证金（provider 命中优先，
 * 否则 `global`）。百分比保证金作用在折后金额上，固定金额与百分比如同时配置则叠加。
 *
 * 配置读写：GET/PATCH 端点读写 `litellm_settings` 对应字段（DB 优先，yaml 兜底）；
 * 计算热路径通过进程内快照读取，快照在启动预热时加载、PATCH 后立即更新，
 * 其余进程的改动在 TTL 到期后的下一次读取刷新。
 */

import { ApiError } from "../core/api/ApiError";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { createModuleLogger } from "../core/utils/logger";
import { LlmProviders } from "../types/provider";

const logger = createModuleLogger("CostTracking");

/** `litellm_settings` 中的折扣配置键 */
export const COST_DISCOUNT_CONFIG_KEY = "cost_discount_config";
/** `litellm_settings` 中的保证金配置键 */
export const COST_MARGIN_CONFIG_KEY = "cost_margin_config";
/** 保证金兜底 provider 键（对未单独配置的 provider 生效） */
export const GLOBAL_MARGIN_KEY = "global";
/** 快照过期时间（毫秒）；到期后下一次读取触发后台刷新 */
const SNAPSHOT_TTL_MS = 60_000;

/** provider → 折扣比例（0..1，表示免掉的比例） */
export type CostDiscountConfig = Record<string, number>;
/** 单个 provider 的保证金：数字表示百分比（0..10），对象可同时给百分比与固定金额 */
export type CostMarginValue = number | { percentage?: number; fixed_amount?: number };
/** provider（或 `global`）→ 保证金 */
export type CostMarginConfig = Record<string, CostMarginValue>;

/** 本进程真实会出现的 provider（`custom_llm_provider`） */
const VALID_PROVIDERS: ReadonlySet<string> = new Set<string>(Object.values(LlmProviders));

/** 折扣比例上限（1 = 100%） */
const MAX_DISCOUNT = 1;
/** 保证金百分比上限（10 = 1000%） */
const MAX_MARGIN_PERCENTAGE = 10;

/** 一次费用调整的分项结果 */
export interface CostAdjustment {
	/** 调整后总额 */
	readonly total: number;
	/** 命中的折扣比例（0 表示未命中） */
	readonly discountPercent: number;
	/** 折扣减免金额（原价 - 折后价，正数表示降价） */
	readonly discountAmount: number;
	/** 命中的保证金比例（0 表示未命中） */
	readonly marginPercent: number;
	/** 命中的固定保证金金额 */
	readonly marginFixedAmount: number;
	/** 保证金合计金额（百分比金额 + 固定金额） */
	readonly marginAmount: number;
}

/** 进程内配置快照 */
export interface CostTrackingSnapshot {
	/** provider → 折扣比例 */
	readonly discount: CostDiscountConfig;
	/** provider（或 global）→ 保证金 */
	readonly margin: CostMarginConfig;
}

/**
 * 折扣是否命中“价格必须是 0..1 的数字”的约束
 * @param value - 待校验值
 */
function isValidDiscountValue(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_DISCOUNT;
}

/**
 * 保证金百分比是否合法
 * @param value - 待校验值
 */
function isValidMarginPercentage(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_MARGIN_PERCENTAGE;
}

/**
 * 保证金固定金额是否合法
 * @param value - 待校验值
 */
function isValidMarginFixedAmount(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 判断是否为普通对象（排除数组与 null）
 * @param value - 待判断值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验并归一 provider 字段
 * @param raw - 请求体/配置值
 * @param extraAllowed - 额外允许的键（保证金允许 `global`）
 * @throws {ApiError} 存在非本部署 provider 的键时抛出 400
 */
function validateProviderKeys(raw: Record<string, unknown>, extraAllowed: ReadonlyArray<string> = []): void {
	const allowed = new Set([...VALID_PROVIDERS, ...extraAllowed]);
	const invalid = Object.keys(raw)
		.filter((key) => !allowed.has(key))
		.sort();
	if (invalid.length === 0) {
		return;
	}
	const allowedList = [...allowed].sort().join(", ");
	throw ApiError.badRequest(
		`Invalid provider(s): ${invalid.join(", ")}. Must be valid LiteLLM providers${extraAllowed.length > 0 ? " or 'global'" : ""}. Available providers on this deployment: ${allowedList}`,
	);
}

/**
 * 校验并归一折扣配置（PATCH 请求体）。
 * @param raw - 请求体
 * @throws {ApiError} 结构、provider 或折扣比例非法时抛出 400
 */
export function normalizeDiscountConfig(raw: unknown): CostDiscountConfig {
	if (!isRecord(raw)) {
		throw ApiError.badRequest("cost_discount_config must be an object mapping provider to discount value");
	}
	validateProviderKeys(raw);
	const config: CostDiscountConfig = {};
	for (const key of Object.keys(raw).sort()) {
		const value = raw[key];
		if (typeof value !== "number") {
			throw ApiError.badRequest(`Discount for ${key} must be a number`);
		}
		if (!isValidDiscountValue(value)) {
			throw ApiError.badRequest(`Discount for ${key} must be between 0 and 1 (0% to 100%)`);
		}
		config[key] = value;
	}
	return config;
}

/**
 * 校验并归一保证金配置（PATCH 请求体）。
 * @param raw - 请求体
 * @throws {ApiError} 结构、provider、百分比或固定金额非法时抛出 400
 */
export function normalizeMarginConfig(raw: unknown): CostMarginConfig {
	if (!isRecord(raw)) {
		throw ApiError.badRequest("cost_margin_config must be an object mapping provider to margin value");
	}
	validateProviderKeys(raw, [GLOBAL_MARGIN_KEY]);
	const config: CostMarginConfig = {};
	for (const key of Object.keys(raw).sort()) {
		const value = raw[key];
		if (typeof value === "number") {
			if (!isValidMarginPercentage(value)) {
				throw ApiError.badRequest(`Margin percentage for ${key} must be between 0 and 10 (0% to 1000%)`);
			}
			config[key] = value;
			continue;
		}
		if (!isRecord(value)) {
			throw ApiError.badRequest(
				`Margin for ${key} must be a number (percentage) or dict with 'percentage' and/or 'fixed_amount'`,
			);
		}
		const entry: { percentage?: number; fixed_amount?: number } = {};
		if (value["percentage"] !== undefined) {
			if (typeof value["percentage"] !== "number") {
				throw ApiError.badRequest(`Margin percentage for ${key} must be a number`);
			}
			if (!isValidMarginPercentage(value["percentage"])) {
				throw ApiError.badRequest(`Margin percentage for ${key} must be between 0 and 10 (0% to 1000%)`);
			}
			entry.percentage = value["percentage"];
		}
		if (value["fixed_amount"] !== undefined) {
			if (typeof value["fixed_amount"] !== "number") {
				throw ApiError.badRequest(`Fixed margin amount for ${key} must be a number`);
			}
			if (!isValidMarginFixedAmount(value["fixed_amount"])) {
				throw ApiError.badRequest(`Fixed margin amount for ${key} must be non-negative`);
			}
			entry.fixed_amount = value["fixed_amount"];
		}
		if (entry.percentage === undefined && entry.fixed_amount === undefined) {
			throw ApiError.badRequest(
				`Margin for ${key} must be a number (percentage) or dict with 'percentage' and/or 'fixed_amount'`,
			);
		}
		config[key] = entry;
	}
	return config;
}

/**
 * 宽容读取折扣配置：单条非法只跳过该条并留痕，不让历史脏值整体失效。
 * @param raw - DB/yaml 中的原始值
 */
export function readDiscountConfig(raw: unknown): CostDiscountConfig {
	if (!isRecord(raw)) {
		return {};
	}
	const config: CostDiscountConfig = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!VALID_PROVIDERS.has(key) || !isValidDiscountValue(value)) {
			logger.warn(`忽略非法的 ${COST_DISCOUNT_CONFIG_KEY} 条目`, { provider: key, value: value as unknown });
			continue;
		}
		config[key] = value;
	}
	return config;
}

/**
 * 宽容读取保证金配置：单条非法只跳过该条并留痕。
 * @param raw - DB/yaml 中的原始值
 */
export function readMarginConfig(raw: unknown): CostMarginConfig {
	if (!isRecord(raw)) {
		return {};
	}
	const config: CostMarginConfig = {};
	for (const [key, value] of Object.entries(raw)) {
		if (!VALID_PROVIDERS.has(key) && key !== GLOBAL_MARGIN_KEY) {
			logger.warn(`忽略非法的 ${COST_MARGIN_CONFIG_KEY} 条目`, { provider: key, value: value as unknown });
			continue;
		}
		if (typeof value === "number") {
			if (!isValidMarginPercentage(value)) {
				logger.warn(`忽略非法的 ${COST_MARGIN_CONFIG_KEY} 条目`, { provider: key, value: value });
				continue;
			}
			config[key] = value;
			continue;
		}
		if (!isRecord(value)) {
			logger.warn(`忽略非法的 ${COST_MARGIN_CONFIG_KEY} 条目`, { provider: key, value: value as unknown });
			continue;
		}
		const entry: { percentage?: number; fixed_amount?: number } = {};
		const percentage = value["percentage"];
		const fixedAmount = value["fixed_amount"];
		if (isValidMarginPercentage(percentage)) {
			entry.percentage = percentage;
		}
		if (isValidMarginFixedAmount(fixedAmount)) {
			entry.fixed_amount = fixedAmount;
		}
		if (entry.percentage === undefined && entry.fixed_amount === undefined) {
			logger.warn(`忽略非法的 ${COST_MARGIN_CONFIG_KEY} 条目`, { provider: key, value: value });
			continue;
		}
		config[key] = entry;
	}
	return config;
}

/**
 * 从请求/deployment 解析 provider，与 SpendLogs.custom_llm_provider 口径一致：
 * 优先显式 custom_llm_provider，其次模型名的 provider 前缀（`provider/model`）。
 * 无法解析时返回空串——此时只有 `global` 保证金生效。
 * @param customLlmProvider - 显式 provider（可空）
 * @param model - 模型名
 */
export function resolveCostProvider(customLlmProvider: string | undefined | null, model: string): string {
	if (typeof customLlmProvider === "string" && customLlmProvider.trim() !== "") {
		return customLlmProvider;
	}
	const slashIndex = model.indexOf("/");
	return slashIndex > 0 ? model.slice(0, slashIndex) : "";
}

/**
 * 应用 provider 折扣。
 * @param baseCost - 基础费用
 * @param provider - provider
 * @param config - 折扣配置
 */
export function applyCostDiscount(
	baseCost: number,
	provider: string,
	config: CostDiscountConfig,
): { cost: number; percent: number; amount: number } {
	const percent = provider === "" ? undefined : config[provider] ?? (isSubscriptionProvider(provider) ? config["cliproxy"] : undefined);
	if (percent === undefined) {
		return { cost: baseCost, percent: 0, amount: 0 };
	}
	const cost = baseCost * (1 - percent);
	return { cost: cost, percent: percent, amount: baseCost - cost };
}

/**
 * 应用 provider 保证金（provider 命中优先，否则 `global`）。
 * @param baseCost - 折后费用
 * @param provider - provider
 * @param config - 保证金配置
 */
export function applyCostMargin(
	baseCost: number,
	provider: string,
	config: CostMarginConfig,
): { cost: number; percent: number; fixedAmount: number; amount: number } {
	const entry = (provider === "" ? undefined : config[provider]) ?? (isSubscriptionProvider(provider) ? config["cliproxy"] : undefined) ?? config[GLOBAL_MARGIN_KEY];
	if (entry === undefined) {
		return { cost: baseCost, percent: 0, fixedAmount: 0, amount: 0 };
	}
	const percent = typeof entry === "number" ? entry : (entry.percentage ?? 0);
	const fixedAmount = typeof entry === "number" ? 0 : (entry.fixed_amount ?? 0);
	const amount = baseCost * percent + fixedAmount;
	return { cost: baseCost + amount, percent: percent, fixedAmount: fixedAmount, amount: amount };
}

/**
 * 按配置对一次请求费用做折扣与保证金调整。
 * @param baseCost - token 基础费用（不含按次固定费用）
 * @param provider - provider
 * @param config - 折扣/保证金配置快照
 */
export function adjustCost(baseCost: number, provider: string, config: CostTrackingSnapshot): CostAdjustment {
	if (!Number.isFinite(baseCost) || baseCost <= 0) {
		return { total: baseCost, discountPercent: 0, discountAmount: 0, marginPercent: 0, marginFixedAmount: 0, marginAmount: 0 };
	}
	const discounted = applyCostDiscount(baseCost, provider, config.discount);
	const margined = applyCostMargin(discounted.cost, provider, config.margin);
	return {
		total: margined.cost,
		discountPercent: discounted.percent,
		discountAmount: discounted.amount,
		marginPercent: margined.percent,
		marginFixedAmount: margined.fixedAmount,
		marginAmount: margined.amount,
	};
}

/**
 * 折扣/保证金配置的进程内快照。
 *
 * 计算热路径是同步的，因此用快照读取；快照来自 `litellm_settings`（DB 优先，
 * yaml 兜底），启动预热加载，PATCH 成功后立刻更新，TTL 到期后后台刷新。
 */
class CostTrackingConfigService {
	private _snapshot: CostTrackingSnapshot = { discount: {}, margin: {} };
	private _loadedAt = 0;
	private _loading: Promise<void> | null = null;

	/**
	 * 同步读取当前快照；快照过期时触发一次后台刷新。
	 */
	getSnapshot(): CostTrackingSnapshot {
		if (Date.now() - this._loadedAt > SNAPSHOT_TTL_MS) {
			void this.refresh();
		}
		return this._snapshot;
	}

	/**
	 * 从 `litellm_settings` 重新加载配置。
	 * @param force - 忽略 TTL，强制读取
	 */
	async refresh(force = false): Promise<void> {
		if (!force && Date.now() - this._loadedAt <= SNAPSHOT_TTL_MS) {
			return;
		}
		this._loading ??= this._load().finally(() => {
			this._loading = null;
		});
		await this._loading;
	}

	/**
	 * 直接更新进程内快照（PATCH 成功后调用）。
	 * @param discount - 折扣配置
	 * @param margin - 保证金配置
	 */
	setValues(discount: CostDiscountConfig, margin: CostMarginConfig): void {
		this._snapshot = { discount: { ...discount }, margin: { ...margin } };
		this._loadedAt = Date.now();
	}

	/** 清空快照（测试用） */
	reset(): void {
		this._snapshot = { discount: {}, margin: {} };
		this._loadedAt = 0;
		this._loading = null;
	}

	private async _load(): Promise<void> {
		const settings = await dbConfigProvider.getEffectiveParam("litellm_settings");
		try {
			this._snapshot = {
				discount: readDiscountConfig(settings[COST_DISCOUNT_CONFIG_KEY]),
				margin: readMarginConfig(settings[COST_MARGIN_CONFIG_KEY]),
			};
			this._loadedAt = Date.now();
		} catch (error) {
			logger.warn("加载费用折扣/保证金配置失败", { error: (error as Error).message });
		}
	}
}

/** 全局单例 */
export const costTrackingConfigService = new CostTrackingConfigService();
