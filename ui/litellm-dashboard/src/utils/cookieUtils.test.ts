import { beforeEach, describe, expect, it } from "vitest";
import { getCookie } from "./cookieUtils";

describe("cookieUtils", () => {
	beforeEach(() => {
		document.cookie = "litellm_csrf_token=; Max-Age=0; path=/";
	});

	it("读取公开 CSRF cookie", () => {
		document.cookie = "litellm_csrf_token=csrf-value; path=/";
		expect(getCookie("litellm_csrf_token")).toBe("csrf-value");
	});

	it("cookie 不存在时返回 null", () => {
		expect(getCookie("missing")).toBeNull();
	});

	it("解码 URL encoded cookie", () => {
		document.cookie = "litellm_csrf_token=a%2Fb%3Dc; path=/";
		expect(getCookie("litellm_csrf_token")).toBe("a/b=c");
	});
});
