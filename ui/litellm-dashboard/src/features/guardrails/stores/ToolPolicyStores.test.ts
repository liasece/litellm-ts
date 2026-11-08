import { nextTick } from "vue";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createToolPoliciesStore } from "./ToolPoliciesStore";
import { createMonitorRequestStore } from "./MonitorRequestStore";
import { toolPoliciesApi } from "../api/ToolPoliciesApi";
import { toolPolicyMetrics } from "../logic/ToolPolicyListLogic";
import type { ToolPolicyRow } from "../support/ToolPolicyModels";
const row = (id: string): ToolPolicyRow => ({ tool_id: id, tool_name: id, input_policy: "untrusted", output_policy: "untrusted" });
afterEach(() => vi.useRealTimers());
describe("Discovered tool policy behavior", () => {
	it("counts newly discovered tools by UTC day and counts distinct nonempty teams", () => {
		const now = new Date("2026-03-08T01:00:00Z"),
			tools = [
				{ ...row("today"), created_at: "2026-03-08T02:00:00+01:00", team_id: "team" },
				{ ...row("yesterday"), created_at: "2026-03-08T00:30:00+02:00", team_id: "team", input_policy: "blocked" },
				{ ...row("older"), created_at: "2026-03-06T00:00:00Z", team_id: "" },
			];
		expect(toolPolicyMetrics(tools, now)).toMatchObject({
			newToday: 1,
			newYesterday: 1,
			trendSubtitle: undefined,
			totalTools: 3,
			blockedCount: 1,
			activeTeamsCount: 1,
			needsReviewTools: [expect.objectContaining({ tool_name: "today" })],
		});
	});
	it("refreshes every fifteen seconds until live tail is disabled and stops on disposal", async () => {
		vi.useFakeTimers();
		const list = vi.fn<typeof toolPoliciesApi.list>().mockResolvedValue([row("example")]),
			store = createToolPoliciesStore(() => true, { ...toolPoliciesApi, list });
		await store.load();
		await vi.advanceTimersByTimeAsync(15000);
		expect(list).toHaveBeenCalledTimes(2);
		store.state.liveTail = false;
		await nextTick();
		await vi.advanceTimersByTimeAsync(30000);
		expect(list).toHaveBeenCalledTimes(2);
		store.state.liveTail = true;
		await nextTick();
		store.dispose();
		await vi.advanceTimersByTimeAsync(30000);
		expect(list).toHaveBeenCalledTimes(2);
	});
	it("updates matching rows only after a successful policy save and keeps old values on failure", async () => {
		const list = vi.fn<typeof toolPoliciesApi.list>().mockResolvedValue([row("example"), row("second")]),
			update = vi.fn<typeof toolPoliciesApi.update>().mockResolvedValue(row("example")),
			alert = vi.fn(),
			store = createToolPoliciesStore(() => true, { ...toolPoliciesApi, list, update }, alert);
		await store.load();
		await store.policy("example", "trusted", "input");
		expect(store.tools.value.map((row) => row.input_policy)).toEqual(["trusted", "untrusted"]);
		update.mockRejectedValueOnce(new Error("synthetic rejection"));
		await store.policy("example", "blocked", "input");
		expect(store.tools.value[0].input_policy).toBe("trusted");
		expect(alert).toHaveBeenCalledWith("Failed to update input policy: synthetic rejection");
		expect(store.state.savingInput).toBeNull();
		store.dispose();
	});
	it("resets pagination when searching, filtering or resetting column order", async () => {
		const list = vi.fn<typeof toolPoliciesApi.list>().mockResolvedValue(
				Array.from({ length: 51 }, (_, index) => ({
					...row("tool-" + index),
					call_count: index,
					team_id: index === 50 ? "unique" : "shared",
				})),
			),
			store = createToolPoliciesStore(() => true, { ...toolPoliciesApi, list });
		await store.load();
		expect(store.totalPages.value).toBe(2);
		store.state.page = 2;
		store.search("unique");
		expect(store.state.page).toBe(1);
		expect(store.pageRows.value.map((row) => row.tool_name)).toEqual(["tool-50"]);
		store.search("");
		store.sort("call_count", "desc");
		expect(store.pageRows.value[0].tool_name).toBe("tool-50");
		store.apply({ "Team Name": "shared" });
		expect(store.filtered.value).toHaveLength(50);
		store.sort("call_count", false);
		expect(store.state.sortField).toBe("created_at");
		expect(store.state.sortOrder).toBe("desc");
		store.dispose();
	});
});
describe("Monitor request lifecycle", () => {
	it("cancels a superseded period and prevents a late result from replacing the current period", async () => {
		let first: ((value: string) => void) | undefined;
		const signals: AbortSignal[] = [],
			load = vi
				.fn<(signal: AbortSignal) => Promise<string>>()
				.mockImplementationOnce((signal) => {
					signals.push(signal);
					return new Promise((resolve) => (first = resolve));
				})
				.mockImplementationOnce(async (signal) => {
					signals.push(signal);
					return "new period";
				}),
			store = createMonitorRequestStore(load);
		const pending = store.refresh();
		await store.refresh();
		first?.("old period");
		await pending;
		expect(signals[0].aborted).toBe(true);
		expect(store.data.value).toBe("new period");
		expect(store.loading.value).toBe(false);
		store.dispose();
	});
	it("retains visible detail while a successful mutation is reloading its server result", async () => {
		let finish: ((value: string) => void) | undefined;
		const load = vi
				.fn<() => Promise<string>>()
				.mockResolvedValueOnce("existing")
				.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve))),
			store = createMonitorRequestStore(load);
		await store.refresh();
		const pending = store.refresh(true);
		expect(store.data.value).toBe("existing");
		finish?.("updated");
		await pending;
		expect(store.data.value).toBe("updated");
		store.dispose();
	});
});
