import { normalizeAccountEmail } from "./accountEmail";

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
