import type { ClaudePlugin, PluginDraft, PluginSource } from "../support/PluginModels";
export function pluginDraft(plugin?: ClaudePlugin): PluginDraft {
	return plugin
		? {
				name: plugin.name,
				sourceType: plugin.source.source === "github" ? "github" : "url",
				repo: plugin.source.repo,
				url: plugin.source.url,
				version: plugin.version,
				description: plugin.description,
				category: plugin.category,
				keywords: plugin.keywords?.join(", "),
				authorName: plugin.author?.name,
				authorEmail: plugin.author?.email,
				homepage: plugin.homepage,
			}
		: { name: "", sourceType: "github" };
}
export function validatePluginDraft(draft: PluginDraft): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!draft.name) errors.name = "Please enter plugin name";
	else if (!/^[a-z0-9-]+$/.test(draft.name)) errors.name = "Name must be kebab-case (lowercase, numbers, hyphens only)";
	if (draft.sourceType === "github") {
		if (!draft.repo) errors.repo = "Please enter repository";
		else if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(draft.repo)) errors.repo = "Repository must be in format: org/repo";
	} else {
		if (!draft.url) errors.url = "Please enter git URL";
		else if (!validUrl(draft.url)) errors.url = "Invalid git URL format";
		if (draft.sourceType === "git-subdir") {
			if (!draft.path) errors.path = "Please enter subdirectory path";
			else if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/.test(draft.path))
				errors.path = "Path must be relative segments (alphanumeric, dots, hyphens, underscores), e.g. plugins/plugin-name";
		}
	}
	if (draft.version && !/^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/.test(draft.version))
		errors.version = "Version must be in semantic versioning format (e.g., 1.0.0)";
	if (draft.authorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.authorEmail)) errors.authorEmail = "Please enter a valid email";
	if (draft.homepage && !validUrl(draft.homepage)) errors.homepage = "Please enter a valid URL";
	return errors;
}
function validUrl(value: string) {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}
export function pluginPayload(draft: PluginDraft): Record<string, unknown> {
	const source: PluginSource =
		draft.sourceType === "github"
			? { source: "github", repo: draft.repo?.trim() }
			: draft.sourceType === "git-subdir"
				? { source: "git-subdir", url: draft.url?.trim(), path: draft.path?.trim() }
				: { source: "url", url: draft.url?.trim() };
	const result: Record<string, unknown> = { name: draft.name.trim(), source };
	for (const field of ["version", "description", "homepage"] as const) if (draft[field]) result[field] = draft[field].trim();
	if (draft.authorName || draft.authorEmail)
		result.author = {
			...(draft.authorName ? { name: draft.authorName.trim() } : {}),
			...(draft.authorEmail ? { email: draft.authorEmail.trim() } : {}),
		};
	if (draft.category) result.category = draft.category;
	if (draft.keywords)
		result.keywords = draft.keywords
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
	return result;
}
export function pluginInstallCommand(plugin: ClaudePlugin) {
	return `/plugin marketplace add ${plugin.source.source === "github" && plugin.source.repo ? plugin.source.repo : plugin.source.source === "url" && plugin.source.url ? plugin.source.url : plugin.name}`;
}
export function pluginSourceText(source: PluginSource) {
	return source.source === "github" && source.repo
		? `GitHub: ${source.repo}`
		: source.source === "url" && source.url
			? source.url
			: "Unknown source";
}
export function pluginSourceUrl(source: PluginSource) {
	return source.source === "github" && source.repo
		? `https://github.com/${source.repo}`
		: source.source === "url"
			? source.url
			: undefined;
}
export function pluginCategoryColor(category?: string) {
	const value = category?.toLowerCase() ?? "";
	if (value.includes("development") || value.includes("dev")) return "blue";
	if (value.includes("productivity") || value.includes("workflow")) return "green";
	if (value.includes("learning") || value.includes("education")) return "purple";
	if (value.includes("security") || value.includes("safety")) return "red";
	if (value.includes("data") || value.includes("analytics")) return "orange";
	if (value.includes("integration") || value.includes("api")) return "yellow";
	return "gray";
}
export function pluginDate(value?: string) {
	return value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "N/A";
}
