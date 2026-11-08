import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLoginUrlWithReturn, consumeReturnUrl, isValidReturnUrl, normalizeUrlForCompare, storeReturnUrl } from "./ReturnUrlLogic";

function browser(url: string, cookie = "") {
	const parsed = new URL(url);
	vi.stubGlobal("window", { location: parsed });
	const document = { cookie };
	vi.stubGlobal("document", document);
	return document;
}
afterEach(() => vi.unstubAllGlobals());

describe("Login return destinations", () => {
	it("retains filters, tabs, and page state when sending a protected URL to login", () => {
		const document = browser("https://dashboard.example/ui/?page=logs&status=error");
		storeReturnUrl();
		expect(document.cookie).toContain(encodeURIComponent("https://dashboard.example/ui/?page=logs&status=error"));
		expect(document.cookie).toContain("max-age=300");
		expect(document.cookie).toContain("SameSite=Lax; Secure");
		expect(buildLoginUrlWithReturn("/ui/login")).toBe(
			"/ui/login?redirect_to=https%3A%2F%2Fdashboard.example%2Fui%2F%3Fpage%3Dlogs%26status%3Derror",
		);
	});

	it("rejects cross-origin production redirects while allowing relative paths", () => {
		browser("https://dashboard.example/ui/login");
		expect(isValidReturnUrl("https://foreign.example/ui")).toBe(false);
		expect(isValidReturnUrl("http://dashboard.example/ui")).toBe(false);
		expect(isValidReturnUrl("//foreign.example/ui")).toBe(false);
		expect(isValidReturnUrl("/ui/?page=logs")).toBe(true);
	});

	it("allows same-hostname cross-port development SSO returns", () => {
		browser("http://localhost:5173/ui/login");
		expect(isValidReturnUrl("http://localhost:4000/ui/?page=models")).toBe(true);
		expect(isValidReturnUrl("http://other.local:4000/ui")).toBe(false);
	});

	it("falls back to the stored safe destination when a query destination is invalid", () => {
		const document = browser(
			"https://dashboard.example/ui/login?redirect_to=https%3A%2F%2Fforeign.example",
			"litellm_return_url=%2Fui%2F%3Fpage%3Dusage",
		);
		expect(consumeReturnUrl()).toBe("/ui/?page=usage");
		expect(document.cookie).toBe("litellm_return_url=; path=/; max-age=0");
	});

	it("normalizes a return URL without dropping repeated query values or hash", () => {
		browser("https://dashboard.example/ui/");
		expect(normalizeUrlForCompare("/ui/?z=1&a=first&a=second#detail")).toBe("https://dashboard.example/ui?a=first&a=second&z=1#detail");
	});
});
