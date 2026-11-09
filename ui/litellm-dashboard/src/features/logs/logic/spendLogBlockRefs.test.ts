import { describe, expect, it } from "vitest";
import { SPEND_LOG_REF_MISSING_KEY, isMissingSpendLogBlockRef } from "./spendLogBlockRefs";
describe("missing spend log block references", () => {
	it("matches the placeholder the API returns for a missing block", () => {
		expect(SPEND_LOG_REF_MISSING_KEY).toBe("_litellm_ref_missing");
		expect(isMissingSpendLogBlockRef({ _litellm_ref_missing: "aB3dE6fH9jK2mN5pQ8rS1t" })).toBe(true);
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: "aB3dE6fH9jK2mN5pQ8rS1t" })).toBe(true);
	});
	it("never matches an ordinary message", () => {
		expect(isMissingSpendLogBlockRef({ role: "user", content: "hello" })).toBe(false);
		expect(isMissingSpendLogBlockRef({ role: "assistant", content: "" })).toBe(false);
		expect(isMissingSpendLogBlockRef({ role: "tool", tool_call_id: "call-1", content: "ok" })).toBe(false);
	});
	it("rejects objects that carry other keys besides the placeholder", () => {
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: "aB3dE6fH9jK2mN5pQ8rS1t", role: "user" })).toBe(false);
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: "aB3dE6fH9jK2mN5pQ8rS1t", content: "" })).toBe(false);
	});
	it("rejects values that are not plain objects", () => {
		expect(isMissingSpendLogBlockRef(null)).toBe(false);
		expect(isMissingSpendLogBlockRef(undefined)).toBe(false);
		expect(isMissingSpendLogBlockRef([{ [SPEND_LOG_REF_MISSING_KEY]: "aB3dE6fH9jK2mN5pQ8rS1t" }])).toBe(false);
		expect(isMissingSpendLogBlockRef('{"_litellm_ref_missing":"aB3dE6fH9jK2mN5pQ8rS1t"}')).toBe(false);
	});
	it("requires a non-empty string block id", () => {
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: 42 })).toBe(false);
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: null })).toBe(false);
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: "" })).toBe(false);
		expect(isMissingSpendLogBlockRef({ [SPEND_LOG_REF_MISSING_KEY]: { id: "aB3dE6fH9jK2mN5pQ8rS1t" } })).toBe(false);
	});
});
