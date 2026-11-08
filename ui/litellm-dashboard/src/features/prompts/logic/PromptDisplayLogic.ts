import type { PromptSpec, PromptModelGroup } from "../support/PromptModels";
import { getVersionNumber } from "./PromptSerializationLogic";
export function promptVariables(content?: string) {
	const values: Record<string, string> = {};
	for (const match of (content || "").matchAll(/\{\{(\w+)\}\}/g)) if (!values[match[1]]) values[match[1]] = "example_" + match[1];
	return values;
}
export const getBasePromptId = (prompt?: PromptSpec) => prompt?.prompt_id || "";
export const getVersionedPromptId = (prompt?: PromptSpec) => prompt?.litellm_params?.prompt_id || getBasePromptId(prompt);
export const getCurrentVersion = (prompt?: PromptSpec) =>
	prompt?.version ? String(prompt.version) : getVersionNumber(getVersionedPromptId(prompt));
export function extractPromptModel(prompt: PromptSpec): string | null {
	const params = prompt.litellm_params;
	if (params?.dotprompt_content) {
		const match = params.dotprompt_content.match(/model:\s*([^\n]+)/);
		if (match) return match[1].trim();
	}
	if (typeof params?.prompt_data?.model === "string") return params.prompt_data.model;
	return params?.model || null;
}
export function promptProvider(model: string | null, groups: Map<string, PromptModelGroup>) {
	return model ? groups.get(model)?.providers?.[0] || null : null;
}
