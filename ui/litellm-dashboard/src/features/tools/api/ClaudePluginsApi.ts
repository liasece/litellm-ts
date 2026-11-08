import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { ClaudePlugin } from "../support/PluginModels";
const plugin = z
	.object({
		id: z.string(),
		name: z.string(),
		source: z
			.object({ source: z.string(), repo: z.string().optional(), url: z.string().optional(), path: z.string().optional() })
			.passthrough(),
		enabled: z.boolean(),
		version: z.string().optional(),
		description: z.string().optional(),
		author: z.object({ name: z.string().optional(), email: z.string().optional() }).passthrough().optional(),
		homepage: z.string().optional(),
		keywords: z.array(z.string()).optional(),
		category: z.string().optional(),
		created_at: z.string().optional(),
		updated_at: z.string().optional(),
		created_by: z.string().optional(),
	})
	.passthrough();
export const claudePluginsApi = {
	list: (signal: AbortSignal) =>
		requestJson(
			"/claude-code/plugins?enabled_only=false",
			{ signal },
			(value) => z.object({ plugins: z.array(plugin) }).parse(value).plugins as ClaudePlugin[],
		),
	detail: (id: string, signal: AbortSignal) =>
		requestJson(
			"/claude-code/plugins/" + encodeURIComponent(id),
			{ signal },
			(value) => z.object({ plugin }).parse(value).plugin as ClaudePlugin,
		),
	register: (body: Record<string, unknown>) => requestJson("/claude-code/plugins", { method: "POST", body: JSON.stringify(body) }),
	toggle: (item: ClaudePlugin) =>
		requestJson(`/claude-code/plugins/${encodeURIComponent(item.name)}/${item.enabled ? "disable" : "enable"}`, { method: "POST" }),
	delete: (name: string) => requestJson("/claude-code/plugins/" + encodeURIComponent(name), { method: "DELETE" }),
};
