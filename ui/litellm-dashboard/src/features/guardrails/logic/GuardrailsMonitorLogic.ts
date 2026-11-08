import { parseLocalDate } from "../../date-range/logic/DateRangeLogic";
import type { GuardrailsUsageOverview, GuardrailPerformanceRow, GuardrailsMonitorLog } from "../support/GuardrailsMonitorModels";
export function monitorMetrics(data: GuardrailsUsageOverview | null) {
	const rows = data?.rows ?? [];
	if (data)
		return {
			totalRequests: data.totalRequests ?? 0,
			totalBlocked: data.totalBlocked ?? 0,
			passRate: String(data.passRate ?? 0),
			avgLatency: rows.length ? Math.round(rows.reduce((sum, row) => sum + (row.avgLatency ?? 0), 0) / rows.length) : 0,
			count: rows.length,
		};
	const totalRequests = rows.reduce((sum, row) => sum + row.requestsEvaluated, 0),
		totalBlocked = rows.reduce((sum, row) => sum + Math.round((row.requestsEvaluated * row.failRate) / 100), 0),
		latencies = rows.filter((row) => row.avgLatency != null);
	return {
		totalRequests,
		totalBlocked,
		passRate: totalRequests ? ((1 - totalBlocked / totalRequests) * 100).toFixed(1) : "0",
		avgLatency: latencies.length ? Math.round(latencies.reduce((sum, row) => sum + (row.avgLatency ?? 0), 0) / latencies.length) : 0,
		count: rows.length,
	};
}
export function sortMonitorRows(rows: GuardrailPerformanceRow[], key: string, order: "asc" | "desc") {
	return [...rows].sort((a, b) => (Number(a[key] ?? 0) - Number(b[key] ?? 0)) * (order === "desc" ? -1 : 1));
}
export function sampleMonitorLogs(logs: GuardrailsMonitorLog[], filter: string, size: number) {
	return logs.filter((log) => filter === "all" || log.action === filter).slice(0, size);
}
export function monitorSpendWindow(startDate = "", endDate = "", now = new Date()) {
	const from = startDate ? (parseLocalDate(startDate) ?? new Date(startDate)) : new Date(now.getTime() - 24 * 60 * 60 * 1000),
		to = endDate ? (parseLocalDate(endDate) ?? new Date(endDate)) : new Date(now);
	if (endDate) to.setUTCHours(23, 59, 59, 999);
	const format = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
	return { startTime: format(from), endTime: format(to) };
}
export const monitorColor = (value: number | null | undefined, warning: number, critical: number) =>
	value == null ? "muted" : value > critical ? "red" : value > warning ? "amber" : "green";
