import { describe, expect, it } from "vitest";
import { parseCliProxyResponse } from "./CliProxyResponseSchemas";

describe("CLIProxy response contracts", () => {
	it("retains plugin quota windows and future metadata after validating the fields the UI consumes", () => {
		const payload = {
			provider: "plugin-provider",
			plan: "Max",
			subscription_expires_at: null,
			windows: [{ id: "week", label: "Weekly", used_percent: 22, remaining_percent: 78, resets_at: null, extension: "future" }],
			balances: [],
			fetched_at: "2026-11-07T00:00:00Z",
			new_field: { keep: true },
		};
		expect(parseCliProxyResponse("/subscriptions/accounts/account-1/quota", "GET", payload)).toEqual(payload);
	});
	it("rejects malformed quota rather than displaying an invalid amount as an exhausted account", () => {
		expect(() =>
			parseCliProxyResponse("/subscriptions/accounts/account-1/quota", "GET", {
				provider: "codex",
				plan: null,
				subscription_expires_at: null,
				windows: [{ id: "week", label: "Weekly", used_percent: 0, remaining_percent: "unknown", resets_at: null }],
				balances: [],
				fetched_at: "2026-11-07T00:00:00Z",
			}),
		).toThrow();
	});
});
