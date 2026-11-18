/** Brand of the underlying model, independent of its deployment name and account provider. */
// 品牌名后面既可以跟分隔符（gpt-5 / gemini-3-pro），也常见连写的版本号（gpt5 / gpt4o / gemini3 / grok4）；
// 两种写法都视为同一家族，否则同一模型换个写法就丢掉品牌图标与日志里的 model_family。
const families = [
	{ label: "OpenAI", model: /^(?:gpt|chatgpt|codex|sora|dall-e|whisper|text-embedding)(?:[0-9]|[-_.:]|$)|^o[1-9]/ },
	// Anthropic 的档位名（opus / sonnet / haiku）常被直接用作别名或部署名，不带 claude 前缀。
	{ label: "Claude", model: /^(?:claude|opus|sonnet|haiku)(?:[0-9]|[-_.:]|$)/, namespace: /^anthropic$/ },
	// DeepSeek 的版本号有 deepseek-v3 / deepseekv3 / deepseek3 三种写法。
	{ label: "DeepSeek", model: /^deepseek(?:v?[0-9]|[-_.:]|$)/, namespace: /^(?:deepseek|deepseek-ai)$/ },
	{ label: "Kimi", model: /^(?:kimi|moonshot)(?:[0-9]|[-_.:]|$)/, namespace: /^moonshotai$/ },
	{ label: "Gemini", model: /^gemini(?:[0-9]|[-_.:]|$)/ },
	{ label: "Gemma", model: /^gemma(?:[0-9]|[-_.:]|$)/ },
	{ label: "Google", model: /^(?:imagen|veo)(?:[0-9]|[-_.:]|$)/ },
	{ label: "Grok", model: /^grok(?:[0-9]|[-_.:]|$)/ },
	// MiniMax 的旧系列叫 abab（abab6.5），新系列才叫 MiniMax-M2。
	{ label: "MiniMax", model: /^(?:minimax|abab)(?:[0-9]|[-_.:]|$)/, namespace: /^minimax(?:ai)?$/ },
	{ label: "Qwen", model: /^(?:qwen|qwq|qvq|wan)(?:[0-9]|[-_.:]|$)/, namespace: /^qwen$/ },
	{ label: "GLM", model: /^(?:chatglm|glm)(?:[0-9]|[-_.:]|$)/, namespace: /^(?:z-ai|zhipuai|thudm)$/ },
	// 混元有三种写法：hunyuan-turbo / HunyuanVideo 这类全称、hy4-flash / hy3-preview 这类 hy+版本号短名，
	// 以及中文名「混元」。
	{ label: "Hunyuan", model: /^(?:混元|hunyuan|hy(?:[0-9]|[-_.:]|$))/, namespace: /^(?:tencent|tencentcloud|hunyuan)$/ },
	{ label: "Llama", model: /^(?:meta-)?llama(?:[0-9]|[-_.:]|$)/, namespace: /^meta-llama$/ },
	{
		label: "Mistral",
		model: /^(?:mistral|ministral|mixtral|codestral|devstral|pixtral|magistral)(?:[0-9]|[-_.:]|$)/,
		namespace: /^mistralai$/,
	},
	{ label: "Cohere", model: /^(?:command|embed-(?:english|multilingual))(?:[0-9]|[-_.:]|$)/, namespace: /^cohereforai$/ },
	{ label: "Amazon", model: /^(?:amazon-)?(?:nova|titan)(?:[0-9]|[-_.:]|$)/ },
	{ label: "Perplexity", model: /^sonar(?:[0-9]|[-_.:]|$)/ },
	{ label: "MiMo", model: /^mimo(?:[0-9]|[-_.:]|$)/, namespace: /^(?:xiaomi|xiaomimimo)$/ },
] as const;

/** Display name of a recognized model family. */
export type ModelFamily = (typeof families)[number]["label"];

/** Enumerated families, used by consumers that must cover every recognized brand (e.g. icon assets). */
export const modelFamilies: readonly ModelFamily[] = families.map((item) => item.label);

const rules: readonly { label: ModelFamily; model: RegExp; namespace?: RegExp }[] = families;

function identify(model: string): ModelFamily | undefined {
	const segments = model.trim().toLowerCase().split("/");
	const name = (segments.at(-1) ?? "")
		.replace(/^ft:/, "")
		// Bedrock 的模型 ID 是「区域.厂商.模型」三段式（us.anthropic.claude-…、google.gemma-3-27b-it），
		// 先剥掉这两层前缀再按品牌名匹配。
		.replace(/^(?:(?:us|eu|apac|global|jp|au)\.)?(?:amazon|anthropic|google|meta|mistral|cohere|deepseek)\./, "");
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
