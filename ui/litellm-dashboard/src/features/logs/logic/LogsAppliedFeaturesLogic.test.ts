import { describe, expect, it } from "vitest";
import { appliedFeatures, appliedFeatureTooltip } from "./LogsAppliedFeaturesLogic";
import type { LogEntry } from "../support/LogsModels";
const log = (metadata: LogEntry["metadata"]): LogEntry => ({
	request_id: "fixture",
	startTime: "2026-11-14T00:00:00Z",
	metadata: metadata,
});
describe("log feature column", () => {
	it("renders the server-side feature list in the fixed review order", () => {
		const badges = appliedFeatures(
			log({
				applied_features: [
					{ id: "tag_routing", detail: "default" },
					{ id: "reasoning_effort:default", detail: "high" },
					{ id: "fallback", detail: "a → b", count: 2 },
					{ id: "privacy", detail: "EMAIL×3", count: 3 },
				],
			}),
		);
		expect(badges.map((badge) => badge.id)).toEqual(["privacy", "fallback", "reasoning_effort:default", "tag_routing"]);
		expect(badges[0]).toMatchObject({ icon: "ShieldCheck", detail: "EMAIL×3", count: 3 });
		expect(badges[1]).toMatchObject({ icon: "GitBranch", count: 2 });
	});

	it("treats an explicit empty list as 'nothing applied' instead of falling back to history", () => {
		expect(appliedFeatures(log({ applied_features: null, fallback_models: ["a", "b"] }))).toEqual([]);
		expect(appliedFeatures(log({ applied_features: [] }))).toEqual([]);
	});

	it("ignores unknown ids and malformed entries so a newer backend cannot break the column", () => {
		const badges = appliedFeatures(
			log({ applied_features: [{ id: "future_feature" }, { detail: "no id" }, { id: "alias", detail: "a → b" }, null, "junk"] }),
		);
		expect(badges.map((badge) => badge.id as string)).toEqual(["alias"]);
	});

	it("derives typed fallback badges from routing_trace on rows written before applied_features existed", () => {
		const badges = appliedFeatures(
			log({
				routing_trace: [
					{ routing_type: "general_fallback", from_model: "public-name", to_resolved_model: "backup-a" },
					{ routing_type: "context_window_fallback", from_model: "backup-a", to_resolved_model: "long-context" },
					{ routing_type: "general_fallback", from_model: "long-context", to_resolved_model: "backup-b" },
				],
				fallback_models: ["public-name", "backup-a", "long-context"],
			}),
		);
		expect(badges.map((badge) => badge.id as string)).toEqual(["fallback", "fallback:context_window"]);
		expect(badges[0]).toMatchObject({ detail: "long-context → backup-b", count: 2 });
		expect(badges[1]).toMatchObject({ detail: "backup-a → long-context", count: 1 });
	});

	it("derives one generic fallback badge for rows written before the feature existed", () => {
		const badges = appliedFeatures(log({ fallback_models: ["primary", "backup", "backup-2"] }));
		expect(badges).toEqual([expect.objectContaining({ id: "fallback", detail: "primary → backup-2", count: 2, icon: "GitBranch" })]);
		expect(appliedFeatures(log({ fallback_models: ["primary"] }))).toEqual([]);
		expect(appliedFeatures(log(null))).toEqual([]);
	});

	it("explains each badge with its own value and repetition count", () => {
		const [badge] = appliedFeatures(log({ applied_features: [{ id: "alias:scheduled", detail: "peak → cheap", count: 3 }] }));
		expect(appliedFeatureTooltip(badge)).toBe("Scheduled alias：alias 按每日时段选中目标（峰谷价路由）\npeak → cheap\n共 3 次");
	});
});
