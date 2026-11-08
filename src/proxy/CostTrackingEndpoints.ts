/**
 * 费用折扣 / 保证金 / 估算端点
 *
 * 对齐 Python LiteLLM：
 * - GET/PATCH /config/cost_discount_config
 * - GET/PATCH /config/cost_margin_config
 * - POST /cost/estimate
 *
 * 配置写入 `litellm_settings` 对应字段（DB 优先，yaml 兜底），PATCH 成功后立刻更新
 * 进程内快照，后续请求的费用计算立即按新配置生效（见 CostTrackingConfig）。
 * `/cost/estimate` 只做估算，不写任何数据。
 */

import type { Router as ExpressRouter } from "express";
import { ApiError } from "../core/api/ApiError";
import { registerRoute } from "../core/api/registerRoute";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { DrizzleDb } from "../core/db/Database";
import {
	COST_DISCOUNT_CONFIG_KEY,
	COST_MARGIN_CONFIG_KEY,
	adjustCost,
	costTrackingConfigService,
	normalizeDiscountConfig,
	normalizeMarginConfig,
	readDiscountConfig,
	readMarginConfig,
	resolveCostProvider,
	type CostMarginConfig,
} from "../cost/CostTrackingConfig";
import { ConfigRepository } from "../repositories/ConfigRepository";
import type { UserAPIKeyAuth } from "../types/auth";
import type { Deployment } from "../types/router";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import type { RouterDeploymentsAccessor } from "./ModelsPageSupportEndpoints";
import { buildModelGroupInfoResponse } from "./modelGroupBuilder";

const LITELLM_SETTINGS_PARAM = "litellm_settings";

/**
 * 费用配置的写入只允许 proxy_admin（读出沿用 PY 的「任意已认证 Key」语义）：
 * 折扣与保证金直接改变实际计费金额，不能开放给普通虚拟密钥修改。
 * @param req - 请求（需已经过 authMiddleware）
 * @throws {ApiError} 401（无 auth）或 403（非 proxy_admin）
 */
function assertProxyAdmin(req: { readonly auth?: UserAPIKeyAuth }): void {
	const auth = req.auth;
	if (!auth) {
		throw ApiError.unauthorized("Missing admin auth");
	}
	if (auth.user_role !== PROXY_ADMIN_ROLE) {
		throw new ApiError(403, "Proxy admin role required");
	}
}

/** `/cost/estimate` 响应（字段与 WebUI PricingResults 读取的键一致）。 */
interface CostEstimateResponse {
	model: string;
	input_tokens: number;
	output_tokens: number;
	num_requests_per_day: number | null;
	num_requests_per_month: number | null;
	cost_per_request: number;
	input_cost_per_request: number;
	output_cost_per_request: number;
	margin_cost_per_request: number;
	daily_cost: number | null;
	daily_input_cost: number | null;
	daily_output_cost: number | null;
	daily_margin_cost: number | null;
	monthly_cost: number | null;
	monthly_input_cost: number | null;
	monthly_output_cost: number | null;
	monthly_margin_cost: number | null;
	input_cost_per_token: number | null;
	output_cost_per_token: number | null;
	provider: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取非负数字字段；缺省/null 返回 undefined，非法值抛 400。
 * @param value - 原始值
 * @param field - 字段名（错误信息用）
 * @throws {ApiError} 字段存在但不是非负有限数字时抛出 400
 */
function parseOptionalNonNegativeNumber(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw ApiError.badRequest(`${field} must be a non-negative number`);
	}
	return value;
}

/**
 * 解析 deployments（仅从 Router / 访问器注入获取，不读 yaml 里的静态 model_list，
 * 保证估算价格与 /model_group/info、真实计费来源一致）。
 * @param accessor - Router 或 deployments 访问器
 */
function resolveDeployments(accessor: RouterDeploymentsAccessor | undefined): Deployment[] {
	if (accessor && typeof accessor.getDeployments === "function") {
		try {
			return accessor.getDeployments();
		} catch {
			return [];
		}
	}
	return [];
}

/**
 * 解析一次估算所需的单价与 provider。
 *
 * 价格口径与 `/model_group/info` 相同（deployment model_info / litellm_params 优先，
 * 其次 model_cost_map），因此 WebUI 模型下拉里看到的价格就是估算用的价格。
 * @param deployments - 当前 deployments
 * @param model - 模型组名（或完整 deployment 模型名）
 * @throws {ApiError} 找不到该模型的任何价格时抛出 404
 */
function resolveEstimatePricing(
	deployments: Deployment[],
	model: string,
): { inputCostPerToken: number; outputCostPerToken: number; provider: string | null } {
	const groups = buildModelGroupInfoResponse(deployments).data;
	const group = groups.find((item) => item.model_group === model);
	const deploymentMatch = deployments.find((dep) => dep.litellm_params.model === model || dep.model_name === model);
	const inputCostPerToken = group?.input_cost_per_token ?? null;
	const outputCostPerToken = group?.output_cost_per_token ?? null;
	if (inputCostPerToken === null && outputCostPerToken === null) {
		throw ApiError.notFound(`Could not find pricing for model '${model}'`);
	}
	const provider =
		group?.providers[0] ??
		(deploymentMatch === undefined
			? resolveCostProvider(undefined, model)
			: resolveCostProvider(deploymentMatch.litellm_params.custom_llm_provider, deploymentMatch.litellm_params.model));
	return {
		inputCostPerToken: inputCostPerToken ?? 0,
		outputCostPerToken: outputCostPerToken ?? 0,
		provider: provider === "" ? null : provider,
	};
}

/**
 * 注册费用折扣 / 保证金 / 估算端点。
 * @param router - 已挂鉴权中间件的 Express Router
 * @param db - Drizzle 数据库实例（读写 litellm_settings）
 * @param deploymentsAccessor - Router / deployments 访问器（估算取真实价格）
 */
export function registerCostTrackingRoutes(
	router: ExpressRouter,
	db: DrizzleDb,
	deploymentsAccessor?: RouterDeploymentsAccessor,
): void {
	const configRepository = new ConfigRepository(db);

	// GET 读「DB 覆盖 + yaml 默认」的有效配置（对齐 PY 读取进程内 litellm_settings）；
	// PATCH 只写 DB，yaml 里的其它键保持为默认值。
	registerRoute(router, { method: "get", path: "/config/cost_discount_config" }, async () => {
		const settings = await dbConfigProvider.getEffectiveParam(LITELLM_SETTINGS_PARAM);
		return { values: readDiscountConfig(settings[COST_DISCOUNT_CONFIG_KEY]) };
	});

	registerRoute(router, { method: "patch", path: "/config/cost_discount_config" }, async (req) => {
		assertProxyAdmin(req);
		const config = normalizeDiscountConfig(req.body ?? {});
		const existing = (await configRepository.getParam(LITELLM_SETTINGS_PARAM)) ?? {};
		await configRepository.upsertParam(LITELLM_SETTINGS_PARAM, { ...existing, [COST_DISCOUNT_CONFIG_KEY]: config });
		const snapshot = costTrackingConfigService.getSnapshot();
		costTrackingConfigService.setValues(config, snapshot.margin);
		return { values: config };
	});

	registerRoute(router, { method: "get", path: "/config/cost_margin_config" }, async () => {
		const settings = await dbConfigProvider.getEffectiveParam(LITELLM_SETTINGS_PARAM);
		return { values: readMarginConfig(settings[COST_MARGIN_CONFIG_KEY]) };
	});

	registerRoute(router, { method: "patch", path: "/config/cost_margin_config" }, async (req) => {
		assertProxyAdmin(req);
		const config: CostMarginConfig = normalizeMarginConfig(req.body ?? {});
		const existing = (await configRepository.getParam(LITELLM_SETTINGS_PARAM)) ?? {};
		await configRepository.upsertParam(LITELLM_SETTINGS_PARAM, { ...existing, [COST_MARGIN_CONFIG_KEY]: config });
		const snapshot = costTrackingConfigService.getSnapshot();
		costTrackingConfigService.setValues(snapshot.discount, config);
		return { values: config };
	});

	registerRoute(router, { method: "post", path: "/cost/estimate" }, async (req) => {
		const body = isRecord(req.body) ? req.body : {};
		const model = body["model"];
		if (typeof model !== "string" || model.trim() === "") {
			throw ApiError.badRequest("model is required");
		}
		const inputTokens = parseOptionalNonNegativeNumber(body["input_tokens"], "input_tokens") ?? 0;
		const outputTokens = parseOptionalNonNegativeNumber(body["output_tokens"], "output_tokens") ?? 0;
		const requestsPerDay = parseOptionalNonNegativeNumber(body["num_requests_per_day"], "num_requests_per_day") ?? null;
		const requestsPerMonth = parseOptionalNonNegativeNumber(body["num_requests_per_month"], "num_requests_per_month") ?? null;

		const pricing = resolveEstimatePricing(resolveDeployments(deploymentsAccessor), model);
		const inputCostPerRequest = inputTokens * pricing.inputCostPerToken;
		const outputCostPerRequest = outputTokens * pricing.outputCostPerToken;
		// 与真实计费同口径：先折扣、后保证金（见 CostTrackingConfig.adjustCost）
		const adjusted = adjustCost(inputCostPerRequest + outputCostPerRequest, pricing.provider ?? "", costTrackingConfigService.getSnapshot());
		const costPerRequest = adjusted.total;
		const marginCostPerRequest = adjusted.marginAmount;

		const estimate: CostEstimateResponse = {
			model: model,
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			num_requests_per_day: requestsPerDay,
			num_requests_per_month: requestsPerMonth,
			cost_per_request: costPerRequest,
			input_cost_per_request: inputCostPerRequest,
			output_cost_per_request: outputCostPerRequest,
			margin_cost_per_request: marginCostPerRequest,
			daily_cost: requestsPerDay === null ? null : costPerRequest * requestsPerDay,
			daily_input_cost: requestsPerDay === null ? null : inputCostPerRequest * requestsPerDay,
			daily_output_cost: requestsPerDay === null ? null : outputCostPerRequest * requestsPerDay,
			daily_margin_cost: requestsPerDay === null ? null : marginCostPerRequest * requestsPerDay,
			monthly_cost: requestsPerMonth === null ? null : costPerRequest * requestsPerMonth,
			monthly_input_cost: requestsPerMonth === null ? null : inputCostPerRequest * requestsPerMonth,
			monthly_output_cost: requestsPerMonth === null ? null : outputCostPerRequest * requestsPerMonth,
			monthly_margin_cost: requestsPerMonth === null ? null : marginCostPerRequest * requestsPerMonth,
			input_cost_per_token: pricing.inputCostPerToken,
			output_cost_per_token: pricing.outputCostPerToken,
			provider: pricing.provider,
		};
		return estimate;
	});
}
