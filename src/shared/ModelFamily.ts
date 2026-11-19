// 同一品牌有多种写法：带分隔符（gpt-5 / gemini-3-pro）、连写版本号（gpt5 / gpt4o / deepseekv3）、
// 以及被部署名包住（anthropic/vllm-qwen3.8-27b、strata-qwen3.8-flash-next）。三种都要认成同一家族，
// 否则同一模型换个写法就丢掉品牌图标与日志里的 model_family。
const families = [
	{ label: "OpenAI", stems: ["gpt", "chatgpt", "codex", "sora", "dall-e", "whisper", "text-embedding", "o[1-9]"] },
	// Anthropic 的档位名（opus / sonnet / haiku）常被直接用作别名或部署名，不带 claude 前缀。
	// 注意 anthropic 这个路径前缀不能当品牌兜底：它只是协议兼容层的标记，vLLM、GLM、Qwen 的部署都挂
	// 在 anthropic/ 下面，认成 Claude 会把千问模型画上 Claude 图标。
	{ label: "Claude", stems: ["claude", "opus", "sonnet", "haiku"] },
	{ label: "DeepSeek", stems: ["deepseek"], namespace: /^(?:deepseek|deepseek-ai)$/ },
	{ label: "Kimi", stems: ["kimi", "moonshot"], namespace: /^moonshotai$/ },
	{ label: "Gemini", stems: ["gemini"] },
	{ label: "Gemma", stems: ["gemma"] },
	{ label: "Google", stems: ["imagen", "veo"] },
	{ label: "Grok", stems: ["grok"] },
	// MiniMax 的旧系列叫 abab（abab6.5），新系列才叫 MiniMax-M2。
	{ label: "MiniMax", stems: ["minimax", "abab"], namespace: /^minimax(?:ai)?$/ },
	{ label: "Qwen", stems: ["qwen", "qwq", "qvq", "wan"], namespace: /^qwen$/ },
	{ label: "GLM", stems: ["chatglm", "glm"], namespace: /^(?:z-ai|zhipuai|thudm)$/ },
	// 混元有三种写法：hunyuan-turbo / HunyuanVideo 这类全称、hy4-flash / hy3-preview 这类 hy+版本号短名，
	// 以及中文名「混元」。
	{ label: "Hunyuan", stems: ["hunyuan", "hy", "混元"], namespace: /^(?:tencent|tencentcloud|hunyuan)$/ },
	{ label: "Llama", stems: ["llama"], namespace: /^meta-llama$/ },
	{
		label: "Mistral",
		stems: ["mistral", "ministral", "mixtral", "codestral", "devstral", "pixtral", "magistral"],
		namespace: /^mistralai$/,
	},
	{ label: "Cohere", stems: ["command", "embed-english", "embed-multilingual"], namespace: /^cohereforai$/ },
	{ label: "Amazon", stems: ["nova", "titan"] },
	{ label: "Perplexity", stems: ["sonar"] },
	{ label: "MiMo", stems: ["mimo"], namespace: /^(?:xiaomi|xiaomimimo)$/ },
] as const;

/** Display name of a recognized model family. */
export type ModelFamily = (typeof families)[number]["label"];

/** Enumerated families, used by consumers that must cover every recognized brand (e.g. icon assets). */
export const modelFamilies: readonly ModelFamily[] = families.map((item) => item.label);

/** 品牌名后面允许跟的边界：版本号（含 deepseekv3 这种连写）、分隔符，或名字结束。 */
const SUFFIX = "(?:v?[0-9]|[-_.:]|$)";

const rules = families.map((family) => {
	const stems = "(?:" + family.stems.join("|") + ")";
	return {
		label: family.label as ModelFamily,
		/** 名字以品牌名开头，例如 gpt-5 / qwen3 / 混元。 */
		start: new RegExp("^" + stems + SUFFIX),
		/** 品牌名出现在名字中间，例如 vllm-qwen3.8-27b / strata-qwen3.8-flash-next。 */
		inside: new RegExp("(?:^|[-_.:/])" + stems + SUFFIX),
		namespace: (family as { namespace?: RegExp }).namespace,
	};
});

function identify(model: string): ModelFamily | undefined {
	const segments = model.trim().toLowerCase().split("/");
	const name = (segments.at(-1) ?? "")
		.replace(/^ft:/, "")
		// Bedrock 的模型 ID 是「区域.厂商.模型」三段式（us.anthropic.claude-…、google.gemma-3-27b-it），
		// 先剥掉这两层前缀再按品牌名匹配。
		.replace(/^(?:(?:us|eu|apac|global|jp|au)\.)?(?:amazon|anthropic|google|meta|mistral|cohere|deepseek)\./, "");
	const namespace = segments.at(-2) ?? "";
	// 先看名字开头，再看名字中间（避免把 gpt-qwen-router 这种带前缀装饰的名字归错），
	// 最后才用路径里的厂商层兜底；厂商层只是线索，不是品牌证据。
	return (
		rules.find((rule) => rule.start.test(name))?.label ??
		rules.find((rule) => rule.inside.test(name))?.label ??
		rules.find((rule) => rule.namespace?.test(namespace))?.label
	);
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
