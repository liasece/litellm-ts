import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudePluginsApi } from "./ClaudePluginsApi";
import { searchToolsApi } from "./SearchToolsApi";
import { tagsApi, tagModels, tagEditModels } from "./TagsApi";
describe("Tool API compatibility", () => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	beforeEach(() => {
		fetch.mockReset().mockResolvedValue(new Response("{}"));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "litellm_csrf_token=fixture-csrf" });
	});
	afterEach(() => vi.unstubAllGlobals());
	function last() {
		const [url, init] = fetch.mock.calls.at(-1)!;
		return { url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined };
	}
	it("uses search create/update envelopes and provider query semantics", async () => {
		await searchToolsApi.create({ search_tool_name: "synthetic", litellm_params: { search_provider: "tavily" } });
		expect(last()).toMatchObject({
			url: "/search_tools",
			init: { method: "POST", credentials: "include" },
			body: { search_tool: { search_tool_name: "synthetic", litellm_params: { search_provider: "tavily" } } },
		});
		await searchToolsApi.update("tool/a", { search_tool_name: "edited" });
		expect(last()).toMatchObject({
			url: "/search_tools/tool%2Fa",
			init: { method: "PUT" },
			body: { search_tool: { search_tool_name: "edited" } },
		});
		fetch.mockResolvedValueOnce(new Response('{"results":[]}'));
		await searchToolsApi.query("synthetic", "original query");
		expect(last()).toMatchObject({ url: "/v1/search/synthetic", body: { query: "original query", max_results: 5 } });
	});
	it("toggles plugin names without sending an invented JSON body or bearer credential", async () => {
		await claudePluginsApi.toggle({
			id: "id-a",
			name: "example-plugin",
			source: { source: "github", repo: "example/plugin" },
			enabled: false,
		});
		expect(last()).toMatchObject({ url: "/claude-code/plugins/example-plugin/enable", init: { method: "POST" }, body: undefined });
		const headers = new Headers(last().init.headers);
		expect(headers.get("x-litellm-csrf-token")).toBe("fixture-csrf");
		expect(headers.has("Authorization")).toBe(false);
		await claudePluginsApi.delete("example-plugin");
		expect(last()).toMatchObject({ url: "/claude-code/plugins/example-plugin", init: { method: "DELETE" } });
	});
	it("accepts the current backend empty tag array and the legacy keyed tag response", async () => {
		fetch.mockResolvedValueOnce(new Response("[]"));
		await expect(tagsApi.list(new AbortController().signal)).resolves.toEqual([]);
		fetch.mockResolvedValueOnce(
			new Response('{"example":{"name":"example","models":[],"created_at":"2026-01-01","updated_at":"2026-01-01"}}'),
		);
		await expect(tagsApi.list(new AbortController().signal)).resolves.toMatchObject([{ name: "example", models: [] }]);
	});
	it("retains the different create/edit tag model catalogue queries", async () => {
		fetch.mockResolvedValueOnce(new Response('{"data":[]}'));
		await tagModels();
		expect(last().url).toBe("/v2/model/info?include_team_models=true&page=1&size=50");
		fetch.mockResolvedValueOnce(new Response('{"data":[]}'));
		await tagEditModels();
		expect(last().url).toBe("/models?include_model_access_groups=True");
	});
});
