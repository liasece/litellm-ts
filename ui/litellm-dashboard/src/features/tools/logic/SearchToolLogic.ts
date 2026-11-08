import type { SearchDraft, SearchTool } from "../support/SearchToolModels";
export function searchDraft(tool?: SearchTool): SearchDraft {
	return tool ? { search_tool_name: tool.search_tool_name, ...tool.litellm_params, description: tool.search_tool_info?.description } : {};
}
export function searchToolPayload(draft: SearchDraft) {
	return {
		search_tool_name: draft.search_tool_name,
		litellm_params: {
			search_provider: draft.search_provider,
			api_key: draft.api_key,
			api_base: draft.api_base,
			timeout: draft.timeout ? parseFloat(String(draft.timeout)) : undefined,
			max_retries: draft.max_retries ? parseInt(String(draft.max_retries)) : undefined,
		},
		search_tool_info: draft.description ? { description: draft.description } : undefined,
	};
}
export function searchDraftErrors(draft: SearchDraft, editing = false, testOnly = false): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!testOnly) {
		if (!draft.search_tool_name) errors.search_tool_name = "Please enter a search tool name";
		else if (!editing && !/^[a-zA-Z0-9_-]+$/.test(draft.search_tool_name))
			errors.search_tool_name = "Name can only contain letters, numbers, hyphens, and underscores";
	}
	if (!draft.search_provider) errors.search_provider = "Please select a search provider";
	return errors;
}
export function cleanSearchError(message: string) {
	if (!message) return "Unknown error";
	const cleaned = message
		.split("stack trace:")[0]
		.trim()
		.replace(/^litellm\.(.*?)Error:\s*/, "")
		.replace(/^AuthenticationError:\s*/, "");
	if (cleaned.includes("<html>") || cleaned.includes("<!DOCTYPE")) {
		const title = cleaned.match(/<title>(.*?)<\/title>/);
		if (title) return title[1];
		if (cleaned.includes("401") || cleaned.includes("Authorization Required"))
			return "Authentication failed: Invalid API key or credentials";
		return "Authentication error - please check your API key";
	}
	return cleaned.length > 200 ? cleaned.substring(0, 200) + "..." : cleaned;
}
