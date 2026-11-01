import { getModelGroupAliasTarget, validateModelGroupAliases } from "../shared/ModelGroupAlias";
import type { ModelGroupAliasConfig } from "../shared/ModelGroupAlias";
import { FallbackHandler } from "./FallbackHandler";
import { Router } from "./Router";
import { RoutingStrategyName } from "../types/router";
import { validateAndTransform } from "../core/config";

const scheduled: ModelGroupAliasConfig = {
	model: "minimax",
	timezone: "Asia/Shanghai",
	schedule: [{ start: "00:30", end: "08:30", model: "deepseek" }],
};

describe("daily model group alias routing", () => {
	afterEach(() => jest.useRealTimers());

	it.each([
		["2026-10-24T16:29:59.999Z", "minimax"],
		["2026-10-24T16:30:00.000Z", "deepseek"],
		["2026-10-25T00:29:59.999Z", "deepseek"],
		["2026-10-25T00:30:00.000Z", "minimax"],
		["2026-10-25T16:30:00.000Z", "deepseek"],
	])("selects %s in the explicit timezone with half-open boundaries", (instant, target) => {
		expect(getModelGroupAliasTarget(scheduled, new Date(instant))).toBe(target);
	});

	it("supports multiple intervals and an overnight interval ending at midnight", () => {
		const value = {
			...scheduled,
			timezone: "UTC",
			schedule: [
				{ start: "22:00", end: "00:00", model: "night" },
				{ start: "00:00", end: "06:00", model: "early" },
				{ start: "12:00", end: "14:00", model: "noon" },
			],
		};
		expect(() => validateModelGroupAliases({ flexible: value })).not.toThrow();
		expect(getModelGroupAliasTarget(value, new Date("2026-10-24T23:59:59Z"))).toBe("night");
		expect(getModelGroupAliasTarget(value, new Date("2026-10-25T00:00:00Z"))).toBe("early");
		expect(getModelGroupAliasTarget(value, new Date("2026-10-25T06:00:00Z"))).toBe("minimax");
		expect(getModelGroupAliasTarget(value, new Date("2026-10-25T12:00:00Z"))).toBe("noon");
	});

	it("matches both sides of midnight and follows daylight-saving wall time", () => {
		const value = { ...scheduled, timezone: "America/New_York", schedule: [{ start: "22:00", end: "02:00", model: "night" }] };
		validateModelGroupAliases({ flexible: value });
		expect(getModelGroupAliasTarget(value, new Date("2026-11-01T03:00:00Z"))).toBe("night");
		// 01:30 occurs twice when the clock falls back.
		expect(getModelGroupAliasTarget(value, new Date("2026-11-01T05:30:00Z"))).toBe("night");
		expect(getModelGroupAliasTarget(value, new Date("2026-11-01T06:30:00Z"))).toBe("night");
		expect(getModelGroupAliasTarget(value, new Date("2026-11-01T07:00:00Z"))).toBe("minimax");
	});

	it.each([
		[{ ...scheduled, timezone: undefined }, /timezone/],
		[{ ...scheduled, timezone: "Invalid/Zone" }, /timezone/],
		[{ ...scheduled, schedule: [{ start: "8:00", end: "09:00", model: "deepseek" }] }, /HH:mm/],
		[{ ...scheduled, schedule: [{ start: "24:00", end: "09:00", model: "deepseek" }] }, /HH:mm/],
		[{ ...scheduled, schedule: [{ start: "08:00", end: "08:00", model: "deepseek" }] }, /must differ/],
		[{ ...scheduled, schedule: [{ start: "08:00", end: "09:00", model: "" }] }, /target model/],
		[
			{
				...scheduled,
				schedule: [
					{ start: "22:00", end: "06:00", model: "deepseek" },
					{ start: "05:59", end: "08:00", model: "minimax" },
				],
			},
			/overlap/,
		],
	])("rejects invalid scheduled values %#", (value, error) => {
		expect(() => validateModelGroupAliases({ flexible: value })).toThrow(error);
	});

	it("rejects cycles in inactive branches and keeps the last valid settings on update failure", () => {
		const handler = new FallbackHandler(undefined, { flexible: scheduled });
		expect(() =>
			handler.setModelGroupAlias({
				flexible: { ...scheduled, schedule: [{ start: "00:00", end: "00:01", model: "back" }] },
				back: "flexible",
			}),
		).toThrow(/cycle.*flexible -> back -> flexible/);
		jest.useFakeTimers().setSystemTime(new Date("2026-10-25T02:00:00Z"));
		expect(handler.resolveModelGroup("flexible")).toBe("minimax");
	});

	it("invalidates cached fallback resolutions at schedule boundaries and preserves the trace", () => {
		jest.useFakeTimers().setSystemTime(new Date("2026-10-25T00:29:59Z"));
		const handler = new FallbackHandler(
			{ source: ["nested"], deepseek: ["backup-night"], minimax: ["backup-day"] },
			{ nested: "flexible", flexible: scheduled },
		);
		expect(handler.getNextFallbackWithTrace("source", 0)).toEqual({
			inputModel: "nested",
			resolvedModel: "deepseek",
			resolutionPath: ["nested", "flexible", "deepseek"],
		});
		expect(handler.getFallbackChain("flexible")).toEqual(["backup-night"]);
		jest.setSystemTime(new Date("2026-10-25T00:30:00Z"));
		expect(handler.getNextFallback("source", 0)).toBe("minimax");
		expect(handler.getFallbackChain("flexible")).toEqual(["backup-day"]);
		expect(handler.resolveModelGroupWithTrace("nested").resolutionPath).toEqual(["nested", "flexible", "minimax"]);
	});

	it("keeps deployment override precedence and rejects combined cycles", () => {
		const handler = new FallbackHandler(undefined, { flexible: scheduled }, undefined, undefined, { flexible: "forced" });
		expect(handler.resolveModelGroup("flexible")).toBe("forced");
		expect(() => new FallbackHandler(undefined, { flexible: scheduled }, undefined, undefined, { deepseek: "flexible" })).toThrow(
			/cycle/,
		);
	});

	it("uses the same time throughout a request snapshot and switches for the next request", () => {
		jest.useFakeTimers().setSystemTime(new Date("2026-10-25T00:29:59Z"));
		const deployments = ["deepseek", "minimax"].map((name) => ({
			model_name: name,
			litellm_params: { model: "openai/" + name },
			model_info: { id: name },
		}));
		const router = new Router({ model_list: deployments, routing_strategy: RoutingStrategyName.SimpleShuffle, num_retries: 0 });
		const settings = { model_group_alias: { flexible: scheduled } };
		const first = router.createRuntimeSnapshot(deployments, settings);
		router.runWithRuntimeSnapshot(first, () => {
			expect(router.getAvailableDeployment("flexible")?.deployment.model_name).toBe("deepseek");
			jest.setSystemTime(new Date("2026-10-25T00:30:00Z"));
			expect(router.getAvailableDeployment("flexible")?.deployment.model_name).toBe("deepseek");
			const second = router.createRuntimeSnapshot(deployments, settings);
			router.runWithRuntimeSnapshot(second, () => {
				expect(router.getAvailableDeployment("flexible")?.deployment.model_name).toBe("minimax");
			});
			expect(router.getAvailableDeployment("flexible")?.deployment.model_name).toBe("deepseek");
		});
	});

	it("retains legacy strings, arrays, hidden objects and schedules through YAML configuration", () => {
		const aliases = {
			text: "minimax",
			list: ["deepseek", "minimax"],
			empty: [],
			hidden: { model: "minimax", hidden: true },
			flexible: scheduled,
		};
		for (const section of ["router_settings", "routerSettings", "general_settings", "generalSettings"]) {
			const config = validateAndTransform({ [section]: { model_group_alias: aliases } });
			const settings = section.startsWith("router") ? config.routerSettings : config.generalSettings;
			expect(settings.model_group_alias).toEqual(aliases);
		}
		expect(getModelGroupAliasTarget(aliases.list)).toBe("deepseek");
		expect(getModelGroupAliasTarget(aliases.empty)).toBeUndefined();
		expect(() =>
			validateAndTransform({ router_settings: { model_group_alias: { invalid: { ...scheduled, timezone: "invalid" } } } }),
		).toThrow(/timezone/);
	});
});
