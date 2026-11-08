import { afterEach, describe, it, expect, vi } from "vitest";
import { yamlConfigDiffApi } from "./YamlConfigDiffApi";
import { formatYamlDiffValue } from "../logic/YamlConfigDiffLogic";
afterEach(() => vi.unstubAllGlobals());
describe("YAML config request and value display", () => {
	it("preserves the GET and POST bodies and accepts acknowledgement-only responses", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ has_pending: true, items: [] }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(Response.json({}));
		vi.stubGlobal("fetch", fetch);
		await yamlConfigDiffApi.load();
		await yamlConfigDiffApi.accept("router_settings", "timeout");
		await yamlConfigDiffApi.resolve();
		expect(fetch.mock.calls.map((call) => call[0])).toEqual([
			"/config/yaml_diff",
			"/config/yaml_diff/accept",
			"/config/yaml_diff/resolve",
		]);
		expect(fetch.mock.calls.slice(1).map((call) => [call[1]?.method, JSON.parse(String(call[1]?.body))])).toEqual([
			["POST", { section: "router_settings", key: "timeout" }],
			["POST", {}],
		]);
	});
	it("retains JSON quoting, null placeholders, false/zero values and the original 120-character truncation", () => {
		expect(formatYamlDiffValue(null)).toBe("—");
		expect(formatYamlDiffValue(false)).toBe("false");
		expect(formatYamlDiffValue(0)).toBe("0");
		expect(formatYamlDiffValue("text")).toBe('"text"');
		expect(formatYamlDiffValue("<script>alert(1)</script>")).toBe('"<script>alert(1)</script>"');
		expect(formatYamlDiffValue("x".repeat(130))).toBe(('"' + "x".repeat(130) + '"').slice(0, 120) + "…");
	});
});
