import { Providers, provider_map } from "../../providers/data/ProviderCatalogData";
import type {
	AddMarginParams,
	DiscountConfig,
	EntryEstimate,
	MarginConfig,
	MarginValue,
	ModelEntry,
	MultiModelResult,
} from "../support/CostTrackingModels";
export interface DiscountChange {
	provider: string;
	value: number;
}
export function providerBackendValue(key: string): string | null {
	return provider_map[key] || null;
}
export function providerDisplayName(value: string): string {
	if (value === "global") return "Global";
	const key = Object.keys(provider_map).find((key) => provider_map[key] === value);
	return key ? Providers[key as keyof typeof Providers] : value;
}
export function addDiscount(config: DiscountConfig, provider: string | undefined, text: string): DiscountChange {
	if (!provider || !text) throw new Error("Please select a provider and enter discount percentage");
	const value = Number.parseFloat(text);
	if (Number.isNaN(value) || value < 0 || value > 100) throw new Error("Discount must be between 0% and 100%");
	const backend = providerBackendValue(provider);
	if (!backend) throw new Error("Invalid provider selected");
	if (config[backend])
		throw new Error("Discount for " + Providers[provider as keyof typeof Providers] + " already exists. Edit it in the table above.");
	return { provider: backend, value: value / 100 };
}
export function addMargin(config: MarginConfig, params: AddMarginParams): { provider: string; value: MarginValue } {
	const { selectedProvider, marginType, percentageValue, fixedAmountValue } = params;
	if (!selectedProvider) throw new Error("Please select a provider");
	const provider = selectedProvider === "global" ? "global" : providerBackendValue(selectedProvider);
	if (!provider) throw new Error("Invalid provider selected");
	if (config[provider])
		throw new Error(
			"Margin for " +
				(provider === "global" ? "Global" : Providers[selectedProvider as keyof typeof Providers]) +
				" already exists. Edit it in the table above.",
		);
	if (marginType === "percentage") {
		const value = Number.parseFloat(percentageValue);
		if (Number.isNaN(value) || value < 0 || value > 1000) throw new Error("Percentage must be between 0% and 1000%");
		return { provider, value: value / 100 };
	}
	const value = Number.parseFloat(fixedAmountValue);
	if (Number.isNaN(value) || value < 0) throw new Error("Fixed amount must be non-negative");
	return { provider, value: { fixed_amount: value } };
}
export function estimateRequest(entry: ModelEntry) {
	return {
		model: entry.model,
		input_tokens: entry.input_tokens || 0,
		output_tokens: entry.output_tokens || 0,
		num_requests_per_day: entry.num_requests_per_day || null,
		num_requests_per_month: entry.num_requests_per_month || null,
	};
}
export function aggregateEstimates(entries: ModelEntry[], cache: ReadonlyMap<string, EntryEstimate>): MultiModelResult {
	const rows = entries.map((entry) => {
		const found = cache.get(entry.id);
		return { entry, result: found?.result ?? null, loading: found?.loading ?? false, error: found?.error ?? null };
	});
	const totals: MultiModelResult["totals"] = {
		cost_per_request: 0,
		daily_cost: null,
		monthly_cost: null,
		margin_per_request: 0,
		daily_margin: null,
		monthly_margin: null,
	};
	for (const { result } of rows) {
		if (!result) continue;
		totals.cost_per_request += result.cost_per_request;
		totals.margin_per_request += result.margin_cost_per_request;
		for (const [field, target] of [
			["daily_cost", "daily_cost"],
			["monthly_cost", "monthly_cost"],
			["daily_margin_cost", "daily_margin"],
			["monthly_margin_cost", "monthly_margin"],
		] as const) {
			const value = result[field];
			if (value !== null) totals[target] = (totals[target] ?? 0) + value;
		}
	}
	return { entries: rows, totals };
}
