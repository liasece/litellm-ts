import { describe, expect, it } from "vitest";
import { accountIdentity } from "./AccountIdentityLogic";

describe("account identity", () => {
	it("prefers the OAuth email over a custom label", () => {
		expect(accountIdentity({ email: "user@example.com", label: "Work" })).toBe("user@example.com");
	});

	it("uses the label when a key-based account has no email", () => {
		expect(accountIdentity({ email: null, label: "GOAT" })).toBe("GOAT");
	});

	it("uses the quota identity email before the custom label", () => {
		expect(accountIdentity({ email: null, label: "GOAT" }, "ops@example.com")).toBe("ops@example.com");
		expect(accountIdentity({ email: "account@example.com", label: "GOAT" }, "quota@example.com")).toBe("account@example.com");
	});

	it("returns null when neither identity is available", () => {
		expect(accountIdentity({ email: null, label: null })).toBeNull();
	});
});
