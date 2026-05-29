/**
 * ModelAccessControl 测试
 */
import { ModelAccessControl } from "./ModelAccessControl";

describe("ModelAccessControl", () => {
	let mac: ModelAccessControl;

	beforeEach(() => {
		mac = new ModelAccessControl();
	});

	it("allows any model with * wildcard", () => {
		expect(mac.canAccessModel("claude-sonnet-4-6", ["*"])).toBe(true);
		expect(mac.canAccessModel("gpt-5", ["*"])).toBe(true);
	});

	it("allows prefix wildcard anthropic/*", () => {
		expect(mac.canAccessModel("anthropic/claude-sonnet-4-6", ["anthropic/*"])).toBe(true);
		expect(mac.canAccessModel("anthropic/claude-opus-4-7", ["anthropic/*"])).toBe(true);
	});

	it("rejects non-matching prefix wildcard", () => {
		expect(mac.canAccessModel("openai/gpt-5", ["anthropic/*"])).toBe(false);
	});

	it("allows exact match", () => {
		expect(mac.canAccessModel("gpt-5", ["gpt-4", "gpt-5"])).toBe(true);
	});

	it("rejects no match", () => {
		expect(mac.canAccessModel("claude-opus", ["gpt-4", "gpt-5"])).toBe(false);
	});

	it("allows with empty models list (no restriction)", () => {
		expect(mac.canAccessModel("gpt-5", [])).toBe(true);
	});
});
