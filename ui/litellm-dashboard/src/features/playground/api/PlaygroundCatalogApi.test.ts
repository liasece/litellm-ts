import { afterEach, describe, expect, it, vi } from "vitest";
import { playgroundCatalogApi } from "./PlaygroundCatalogApi";
afterEach(() => vi.unstubAllGlobals());
describe("Playground catalog HTTP contracts", () => {
	it("loads the original proxy settings endpoint and accepts nullable registered MCP names", async () => {
		const urls: string[] = [],
			fetch = vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				urls.push(url);
				return new Response(
					JSON.stringify(
						url.endsWith("/sso/get/ui_settings")
							? { PROXY_BASE_URL: "https://proxy.example.test", LITELLM_UI_API_DOC_BASE_URL: "https://docs.example.test" }
							: { data: [{ server_id: "stdio-fixture", server_name: null, alias: "Local Tools", transport: "stdio" }] },
					),
					{ headers: { "Content-Type": "application/json" } },
				);
			});
		vi.stubGlobal("fetch", fetch);
		const settings = await playgroundCatalogApi.settings(),
			servers = await playgroundCatalogApi.servers();
		expect(urls[0]).toMatch(/\/sso\/get\/ui_settings$/);
		expect(settings.LITELLM_UI_API_DOC_BASE_URL).toBe("https://docs.example.test");
		expect(servers).toMatchObject([{ server_id: "stdio-fixture", server_name: null, alias: "Local Tools" }]);
	});
});
