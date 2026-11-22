import { normalizeAccountEmail, subscriptionAccountDisplayName } from "./accountEmail";

describe("subscription account display email", () => {
	it("trims a registered address and treats a blank value as clearing it", () => {
		expect(normalizeAccountEmail(" owner@example.com ")).toBe("owner@example.com");
		expect(normalizeAccountEmail("")).toBeNull();
		expect(normalizeAccountEmail("   ")).toBeNull();
		expect(normalizeAccountEmail(null)).toBeNull();
		expect(normalizeAccountEmail(undefined)).toBeNull();
	});

	it("rejects values that are not an address", () => {
		expect(() => normalizeAccountEmail("Personal")).toThrow("请填写有效的账号邮箱");
		expect(() => normalizeAccountEmail("owner@example")).toThrow("请填写有效的账号邮箱");
		expect(() => normalizeAccountEmail(7)).toThrow("账号邮箱必须是字符串");
	});
});

describe("subscription account display name", () => {
	it("prefers the upstream email over a registered label and the auth filename", () => {
		expect(
			subscriptionAccountDisplayName({
				email: " owner@example.com ",
				label: "Personal",
				provider: "commandcode",
				accountKey: "codex-abc.json",
				id: "account-1",
			}),
		).toBe("commandcode/owner@example.com");
	});

	it("falls back to the registered label for key-only providers, then the filename", () => {
		expect(
			subscriptionAccountDisplayName({
				email: null,
				label: " owner@example.com ",
				accountKey: "commandcode-managed-abc.json",
				provider: "commandcode",
				id: "account-2",
			}),
		).toBe("commandcode/owner@example.com");
		expect(subscriptionAccountDisplayName({ accountKey: "codex-abc.json", provider: "codex", id: "account-3" })).toBe(
			"codex/codex-abc.json",
		);
		expect(subscriptionAccountDisplayName({ id: "abcdefgh-1234" })).toBe("Subscription abcdefgh");
	});
});
