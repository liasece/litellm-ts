export type DiscountConfig = Record<string, number>;
export interface ProviderMargin extends Record<string, unknown> {
	percentage?: number;
	fixed_amount?: number;
}
export type MarginValue = number | ProviderMargin;
export type MarginConfig = Record<string, MarginValue>;
export interface CostEstimateRequest {
	model: string;
	input_tokens: number;
	output_tokens: number;
	num_requests_per_day?: number | null;
	num_requests_per_month?: number | null;
}
export interface CostEstimateResponse extends CostEstimateRequest {
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
export interface ModelEntry {
	id: string;
	model: string;
	input_tokens: number;
	output_tokens: number;
	num_requests_per_day?: number;
	num_requests_per_month?: number;
}
export interface EntryEstimate {
	entry: ModelEntry;
	result: CostEstimateResponse | null;
	loading: boolean;
	error: string | null;
}
export interface MultiModelResult {
	entries: EntryEstimate[];
	totals: {
		cost_per_request: number;
		daily_cost: number | null;
		monthly_cost: number | null;
		margin_per_request: number;
		daily_margin: number | null;
		monthly_margin: number | null;
	};
}
export interface AddMarginParams {
	selectedProvider: string | undefined;
	marginType: "percentage" | "fixed";
	percentageValue: string;
	fixedAmountValue: string;
}
