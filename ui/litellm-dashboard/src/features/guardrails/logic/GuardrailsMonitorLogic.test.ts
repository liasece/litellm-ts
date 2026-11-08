import { describe, it, expect, vi, afterEach } from "vitest";
import { monitorMetrics, monitorSpendWindow, sampleMonitorLogs, sortMonitorRows } from "./GuardrailsMonitorLogic";
import type { GuardrailPerformanceRow, GuardrailsMonitorLog } from "../support/GuardrailsMonitorModels";
afterEach(() => vi.unstubAllEnvs());
const row = (id: string, latency?: number): GuardrailPerformanceRow => ({
	id,
	name: id,
	type: "synthetic",
	provider: "Custom",
	requestsEvaluated: 100,
	failRate: 5,
	avgLatency: latency,
	status: "healthy",
	trend: "stable",
});
describe("Guardrails Monitor observable calculations", () => {
	it("uses server aggregate totals and averages latency over all rows, including rows without latency", () => {
		const data = { rows: [row("one", 101), row("two")], totalRequests: 900, totalBlocked: 300, passRate: 66.7 };
		expect(monitorMetrics(data)).toEqual({ totalRequests: 900, totalBlocked: 300, passRate: "66.7", avgLatency: 51, count: 2 });
		expect(monitorMetrics(null)).toEqual({ totalRequests: 0, totalBlocked: 0, passRate: "0", avgLatency: 0, count: 0 });
	});
	it("filters before taking the log sample and treats missing numeric sort data as zero", () => {
		const logs: GuardrailsMonitorLog[] = [
			{ id: "a", timestamp: "a", action: "passed" },
			{ id: "b", timestamp: "b", action: "blocked" },
			{ id: "c", timestamp: "c", action: "blocked" },
		];
		expect(sampleMonitorLogs(logs, "blocked", 1).map((log) => log.id)).toEqual(["b"]);
		expect(sortMonitorRows([row("missing"), row("known", 10)], "avgLatency", "desc").map((row) => row.id)).toEqual([
			"known",
			"missing",
		]);
	});
	it("preserves the legacy conversion to UTC before ending the selected end day", () => {
		vi.stubEnv("TZ", "Asia/Shanghai");
		expect(monitorSpendWindow("2026-11-01", "2026-11-02")).toEqual({
			startTime: "2026-10-31 16:00:00",
			endTime: "2026-11-01 23:59:59",
		});
	});
	it("uses calendar date parsing across a daylight saving boundary instead of a fixed offset", () => {
		vi.stubEnv("TZ", "America/New_York");
		expect(monitorSpendWindow("2026-03-08", "2026-03-09")).toEqual({
			startTime: "2026-03-08 05:00:00",
			endTime: "2026-03-09 23:59:59",
		});
	});
});
