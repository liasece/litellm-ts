/** Brand of the underlying model, independent of its deployment name and account provider. */
const families = [
	{ label: "OpenAI", model: /^(?:gpt|chatgpt|codex|o[1-9]|dall-e|whisper|text-embedding)(?:[-_.:]|$)/ },
	{ label: "Claude", model: /^claude(?:[-_.:]|$)/, namespace: /^anthropic$/ },
	{ label: "DeepSeek", model: /^deepseek(?:[-_.:]|$)/, namespace: /^(?:deepseek|deepseek-ai)$/ },
	{ label: "Kimi", model: /^(?:kimi|moonshot)(?:[-_.:]|$)/, namespace: /^moonshotai$/ },
	{ label: "Gemini", model: /^gemini(?:[-_.:]|$)/ },
	{ label: "Gemma", model: /^gemma(?:[0-9]|[-_.:]|$)/ },
	{ label: "Google", model: /^(?:imagen|veo)(?:[-_.:]|$)/ },
	{ label: "Grok", model: /^grok(?:[-_.:]|$)/ },
	{ label: "MiniMax", model: /^minimax(?:[-_.:]|$)/, namespace: /^minimax(?:ai)?$/ },
	{ label: "Qwen", model: /^(?:qwen|qwq|qvq|wan)(?:[0-9]|[-_.:]|$)/, namespace: /^qwen$/ },
	{ label: "GLM", model: /^(?:chatglm|glm)(?:[0-9]|[-_.:]|$)/, namespace: /^(?:z-ai|zhipuai|thudm)$/ },
	{ label: "Llama", model: /^(?:meta-)?llama(?:[0-9]|[-_.:]|$)/, namespace: /^meta-llama$/ },
	{
		label: "Mistral",
		model: /^(?:mistral|ministral|mixtral|codestral|devstral|pixtral|magistral)(?:[0-9]|[-_.:]|$)/,
		namespace: /^mistralai$/,
	},
	{ label: "Cohere", model: /^(?:command|embed-(?:english|multilingual))(?:[-_.:]|$)/, namespace: /^cohereforai$/ },
	{ label: "Amazon", model: /^(?:amazon-)?(?:nova|titan)(?:[-_.:]|$)/ },
	{ label: "Perplexity", model: /^sonar(?:[-_.:]|$)/ },
	{ label: "MiMo", model: /^mimo(?:[-_.:]|$)/, namespace: /^(?:xiaomi|xiaomimimo)$/ },
] as const;

/** Display name of a recognized model family. */
export type ModelFamily = (typeof families)[number]["label"];

const rules: readonly { label: ModelFamily; model: RegExp; namespace?: RegExp }[] = families;

function identify(model: string): ModelFamily | undefined {
	const segments = model.trim().toLowerCase().split("/");
	const name = (segments.at(-1) ?? "")
		.replace(/^ft:/, "")
		.replace(/^(?:(?:us|eu|apac|global|jp|au)\.)?(?:amazon|anthropic|meta|mistral|cohere|deepseek)\./, "");
	const namespace = segments.at(-2) ?? "";
	return (rules.find((item) => item.model.test(name)) ?? rules.find((item) => item.namespace?.test(namespace)))?.label;
}

/**
 * Resolve opaque deployment IDs through their configured base model when available.
 * @param model
 * @param baseModel
 */
export function resolveModelFamily(model: string, baseModel?: unknown): ModelFamily | undefined {
	return identify(model) ?? (typeof baseModel === "string" ? identify(baseModel) : undefined);
}

/**
 * Check family names supplied by the group catalog.
 * @param value
 */
export function isModelFamily(value: unknown): value is ModelFamily {
	return rules.some((rule) => rule.label === value);
}
