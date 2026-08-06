import { normalizeBuiltinCapabilitiesConfig } from "./BuiltinCapabilitiesConfig";

describe("BuiltinCapabilitiesConfig", () => {
	it("defaults worker output limits to 32K and preserves values above the former 16K ceiling", () => {
		const defaults = normalizeBuiltinCapabilitiesConfig({});
		expect(defaults.vision.max_output_tokens).toBe(32_768);
		expect(defaults.web.max_output_tokens).toBe(32_768);

		const configured = normalizeBuiltinCapabilitiesConfig({
			vision: { max_output_tokens: 65_536 },
			web: { max_output_tokens: 131_072 },
		});
		expect(configured.vision.max_output_tokens).toBe(65_536);
		expect(configured.web.max_output_tokens).toBe(131_072);
	});
});
