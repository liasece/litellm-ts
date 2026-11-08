import { describe, expect, it } from "vitest";
import { pluginInstallCommand, pluginSourceText, pluginSourceUrl } from "./PluginDraftLogic";
import type { ClaudePlugin } from "../support/PluginModels";
describe("plugin source presentation", () => {
	it("keeps the GitHub label and repository link in plugin details", () => {
		const source = { source: "github", repo: "example/synthetic-plugin" };
		expect(pluginSourceText(source)).toBe("GitHub: example/synthetic-plugin");
		expect(pluginSourceUrl(source)).toBe("https://github.com/example/synthetic-plugin");
	});
	it("preserves fallback commands and unknown-source presentation", () => {
		const plugin = {
			name: "synthetic",
			source: { source: "git-subdir", url: "https://example.test/repo", path: "plugins/a" },
		} as ClaudePlugin;
		expect(pluginSourceText(plugin.source)).toBe("Unknown source");
		expect(pluginSourceUrl(plugin.source)).toBeUndefined();
		expect(pluginInstallCommand(plugin)).toBe("/plugin marketplace add synthetic");
	});
});
