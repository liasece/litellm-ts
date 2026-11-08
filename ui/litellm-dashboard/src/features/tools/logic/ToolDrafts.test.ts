import { describe, it, expect } from "vitest";
import { pluginDraft, pluginPayload, validatePluginDraft } from "./PluginDraftLogic";
import { searchToolPayload, searchDraftErrors, cleanSearchError } from "./SearchToolLogic";
describe("Tool editor request semantics", () => {
	it("registers git-subdir sources and omits untouched optional plugin fields", () => {
		const draft = {
			name: "example-plugin",
			sourceType: "git-subdir" as const,
			url: "https://example.test/repo.git",
			path: "plugins/example",
		};
		expect(validatePluginDraft(draft)).toEqual({});
		expect(pluginPayload(draft)).toEqual({
			name: "example-plugin",
			source: { source: "git-subdir", url: "https://example.test/repo.git", path: "plugins/example" },
		});
		expect(pluginPayload({ ...draft, authorEmail: "author@example.test", keywords: " alpha, ,beta " })).toMatchObject({
			author: { email: "author@example.test" },
			keywords: ["alpha", "beta"],
		});
	});
	it("rejects invalid plugin names, semantic versions and relative paths before any request", () => {
		expect(
			validatePluginDraft({
				name: "Wrong Name",
				sourceType: "git-subdir",
				url: "https://example.test/repo",
				path: "../outside",
				version: "1.2",
			}),
		).toEqual({
			name: "Name must be kebab-case (lowercase, numbers, hyphens only)",
			path: "Path must be relative segments (alphanumeric, dots, hyphens, underscores), e.g. plugins/plugin-name",
			version: "Version must be in semantic versioning format (e.g., 1.0.0)",
		});
		expect(pluginDraft()).toEqual({ name: "", sourceType: "github" });
	});
	it("keeps the original search envelope and optional parsing without inventing empty metadata", () => {
		expect(
			JSON.parse(
				JSON.stringify(
					searchToolPayload({ search_tool_name: "test", search_provider: "tavily", timeout: "1.5", max_retries: "2" }),
				),
			),
		).toEqual({ search_tool_name: "test", litellm_params: { search_provider: "tavily", timeout: 1.5, max_retries: 2 } });
		expect(searchDraftErrors({ search_provider: "tavily" }, false, true)).toEqual({});
		expect(searchDraftErrors({ search_tool_name: "a b", search_provider: "tavily" })).toHaveProperty("search_tool_name");
		expect(searchDraftErrors({ search_tool_name: "a b", search_provider: "tavily" }, true)).toEqual({});
	});
	it("renders connection failures with the same readable error and retains full details separately", () => {
		expect(cleanSearchError("litellm.AuthenticationError: AuthenticationError: Invalid credentials stack trace: hidden")).toBe(
			"Invalid credentials",
		);
		expect(cleanSearchError("<html><title>Authorization Required</title></html>")).toBe("Authorization Required");
		expect(cleanSearchError("x".repeat(250))).toBe("x".repeat(200) + "...");
	});
});
