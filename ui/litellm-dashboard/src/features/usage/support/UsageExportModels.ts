import type { DailyActivityResponse, MetricWithMetadata, SpendMetrics } from "./UsageModels";
export type ExportFormat = "csv" | "json";
export type ExportScope = "daily" | "daily_with_keys" | "daily_with_models";
export type ExportRow = Record<string, string | number>;
export type EntitySpendData = DailyActivityResponse;
export interface EntityBreakdown {
	metrics: SpendMetrics;
	metadata: { alias: string; id: string };
}
export type EntityDictionary = Record<string, MetricWithMetadata>;
