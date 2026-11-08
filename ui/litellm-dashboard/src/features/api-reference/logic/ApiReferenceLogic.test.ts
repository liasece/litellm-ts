import { describe, expect, it } from "vitest";
import { apiReferenceBaseUrl } from "./ApiReferenceLogic";
describe("API documentation base URL", () => {
	it("uses the configured documentation endpoint before the proxy and preserves its text", () => {
		expect(
			apiReferenceBaseUrl({
				LITELLM_UI_API_DOC_BASE_URL: " https://docs.example.test/v1 ",
				PROXY_BASE_URL: "https://proxy.example.test",
			}),
		).toBe(" https://docs.example.test/v1 ");
	});
	it("falls back through a blank override to the proxy or the original placeholder", () => {
		expect(apiReferenceBaseUrl({ LITELLM_UI_API_DOC_BASE_URL: " ", PROXY_BASE_URL: "https://proxy.example.test" })).toBe(
			"https://proxy.example.test",
		);
		expect(apiReferenceBaseUrl({})).toBe("<your_proxy_base_url>");
	});
});
