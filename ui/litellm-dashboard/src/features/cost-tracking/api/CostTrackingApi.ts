import { z } from "zod";
import { dashboardFetch, deriveErrorMessage, getApiBaseUrl, HttpApiError } from "../../platform/api/HttpApiClient";
import type { CostEstimateRequest, DiscountConfig, MarginConfig } from "../support/CostTrackingModels";
const number = z.number().finite();
const discount = z.record(z.string(), number),
	margin = z.record(
		z.string(),
		z.union([number, z.object({ percentage: number.optional(), fixed_amount: number.optional() }).passthrough()]),
	);
const estimate = z
	.object({
		model: z.string(),
		input_tokens: number,
		output_tokens: number,
		num_requests_per_day: number.nullable(),
		num_requests_per_month: number.nullable(),
		cost_per_request: number,
		input_cost_per_request: number,
		output_cost_per_request: number,
		margin_cost_per_request: number,
		daily_cost: number.nullable(),
		daily_input_cost: number.nullable(),
		daily_output_cost: number.nullable(),
		daily_margin_cost: number.nullable(),
		monthly_cost: number.nullable(),
		monthly_input_cost: number.nullable(),
		monthly_output_cost: number.nullable(),
		monthly_margin_cost: number.nullable(),
		input_cost_per_token: number.nullable(),
		output_cost_per_token: number.nullable(),
		provider: z.string().nullable(),
	})
	.passthrough();
function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
async function request<T>(path: string, init: RequestInit, parse: (value: unknown) => T): Promise<T> {
	const response = await dashboardFetch(getApiBaseUrl() + path, {
		...init,
		headers: { "Content-Type": "application/json", ...init.headers },
	});
	const data: unknown = await response.json();
	if (!response.ok) {
		// 后端统一错误体是 { error: { message } }（PY 兼容端点用 detail），
		// 校验错误（如非法 provider、超范围比例）必须原样告知用户，不能退化成通用文案。
		const fallback = path === "/cost/estimate" ? "Failed to estimate cost" : "Failed to update settings";
		throw new HttpApiError(data === undefined ? fallback : deriveErrorMessage(data), response.status);
	}
	return parse(data);
}
export const costTrackingApi = {
	discounts: () => request("/config/cost_discount_config", {}, (value) => discount.parse(object(value).values ?? {})),
	margins: () => request("/config/cost_margin_config", {}, (value) => margin.parse(object(value).values ?? {})),
	saveDiscounts: (data: DiscountConfig) =>
		request("/config/cost_discount_config", { method: "PATCH", body: JSON.stringify(data) }, (value) => value),
	saveMargins: (data: MarginConfig) =>
		request("/config/cost_margin_config", { method: "PATCH", body: JSON.stringify(data) }, (value) => value),
	models: () =>
		request("/model_group/info", {}, (value) =>
			z
				.object({ data: z.array(z.object({ model_group: z.string() }).passthrough()) })
				.passthrough()
				.parse(value)
				.data.map((model) => model.model_group)
				.sort((a, b) => a.localeCompare(b)),
		),
	estimate: (data: CostEstimateRequest, signal?: AbortSignal) =>
		request("/cost/estimate", { method: "POST", body: JSON.stringify(data), signal }, (value) => estimate.parse(value)),
};
export type CostTrackingApi = typeof costTrackingApi;
