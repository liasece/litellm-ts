import { describe, expect, it } from "vitest";
import { applyVisualValues, visualValuesFromConfig } from "./ConfigEditorLogic";

describe("CLIProxy graphical configuration", () => {
	it("applies edited settings while preserving advanced provider and routing configuration", () => {
		const source = {
			routing: { strategy: "fill-first", "session-affinity": true, advanced: { keep: ["provider"] } },
			"quota-exceeded": { "switch-project": false, custom: "retained" },
			plugins: [{ id: "test-plugin", settings: { mode: "custom" } }],
			"oauth-model-alias": { codex: [{ name: "one", alias: "preferred" }] },
		};
		const values = visualValuesFromConfig(source);
		values.routingStrategy = "weighted-round-robin";
		values.requestRetry = 7;
		const updated = applyVisualValues(source, values);
		expect(updated.routing).toEqual({
			strategy: "weighted-round-robin",
			"session-affinity": true,
			"session-affinity-ttl": "1h",
			advanced: { keep: ["provider"] },
		});
		expect(updated["quota-exceeded"]).toMatchObject({ "switch-project": false, custom: "retained" });
		expect(updated.plugins).toEqual(source.plugins);
		expect(updated["oauth-model-alias"]).toEqual(source["oauth-model-alias"]);
		expect(updated["request-retry"]).toBe(7);
		expect(source.routing.strategy).toBe("fill-first");
		expect(source).not.toHaveProperty("request-retry");
	});

	it.each(["chat", "passthrough"] as const)("preserves the %s image-generation mode when saving unrelated edits", (mode) => {
		const values = visualValuesFromConfig({ "disable-image-generation": mode });
		values.debug = true;
		expect(applyVisualValues({}, values)["disable-image-generation"]).toBe(mode);
	});

	it("writes boolean image-generation modes and removes cleared optional overrides", () => {
		const source = { "auth-auto-refresh-workers": 12, "gpt-image-2-base-model": "custom-model" };
		const values = visualValuesFromConfig(source);
		values.authAutoRefreshWorkers = null;
		values.gptImage2BaseModel = "   ";
		values.disableImageGeneration = "true";
		const enabled = applyVisualValues(source, values);
		expect(enabled).not.toHaveProperty("auth-auto-refresh-workers");
		expect(enabled).not.toHaveProperty("gpt-image-2-base-model");
		expect(enabled["disable-image-generation"]).toBe(true);
		values.disableImageGeneration = "false";
		expect(applyVisualValues(source, values)["disable-image-generation"]).toBe(false);
	});
});
