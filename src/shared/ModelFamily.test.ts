import { resolveModelFamily } from "./ModelFamily";

describe("model family", () => {
	it("treats Anthropic tier names without a claude prefix as Claude", () => {
		// 别名和部署名常直接写档位名（opus / haiku / sonnet），品牌应仍是 Claude。
		expect(resolveModelFamily("opus")).toBe("Claude");
		expect(resolveModelFamily("haiku")).toBe("Claude");
		expect(resolveModelFamily("sonnet")).toBe("Claude");
		expect(resolveModelFamily("opus-4-6")).toBe("Claude");
		expect(resolveModelFamily("sonnet-4.5")).toBe("Claude");
		expect(resolveModelFamily("haiku35")).toBe("Claude");
		expect(resolveModelFamily("anthropic/opus")).toBe("Claude");
	});

	it("keeps prefixed Claude deployments and OpenAI reasoning ids apart", () => {
		expect(resolveModelFamily("claude-sonnet-4-5")).toBe("Claude");
		expect(resolveModelFamily("us.anthropic.claude-sonnet-4-5:0")).toBe("Claude");
		// "o"+数字 是 OpenAI 的推理模型；档位名不能把这类短名一起吞掉。
		expect(resolveModelFamily("o3-mini")).toBe("OpenAI");
		expect(resolveModelFamily("gpt-4o")).toBe("OpenAI");
		expect(resolveModelFamily("opuslike-turbo")).toBeUndefined();
	});

	it("accepts version numbers written without a separator", () => {
		// 同一模型换成连写版本号（gpt5 / gemini3 / grok4）不该丢品牌。
		expect(resolveModelFamily("gpt5")).toBe("OpenAI");
		expect(resolveModelFamily("gpt4o")).toBe("OpenAI");
		expect(resolveModelFamily("gemini3")).toBe("Gemini");
		expect(resolveModelFamily("grok4")).toBe("Grok");
		expect(resolveModelFamily("deepseekv3")).toBe("DeepSeek");
		expect(resolveModelFamily("veo3")).toBe("Google");
		expect(resolveModelFamily("kimi2")).toBe("Kimi");
		expect(resolveModelFamily("nova2")).toBe("Amazon");
		expect(resolveModelFamily("sonar2")).toBe("Perplexity");
		expect(resolveModelFamily("mimo2")).toBe("MiMo");
		expect(resolveModelFamily("command4")).toBe("Cohere");
		// 品牌名后跟非版本号字母仍是未知模型，不能靠前缀猜品牌。
		expect(resolveModelFamily("gptx-1")).toBeUndefined();
		expect(resolveModelFamily("geminix")).toBeUndefined();
	});

	it("strips Bedrock's region and vendor prefixes for every brand it hosts", () => {
		expect(resolveModelFamily("google.gemma-3-27b-it")).toBe("Gemma");
		expect(resolveModelFamily("us.google.gemma-3-27b-it")).toBe("Gemma");
		expect(resolveModelFamily("us.anthropic.claude-3-5-haiku")).toBe("Claude");
		expect(resolveModelFamily("apac.meta.llama3-70b")).toBe("Llama");
	});

	it("recognizes the brand when the deployment name wraps it in vendor or vLLM decorations", () => {
		// 自建 vLLM 部署常把上游模型挂成 anthropic/vllm-qwen3.8-27b：anthropic 只是协议兼容层，
		// 品牌要看名字里的 qwen，不能因为走 Anthropic 协议就把千问画成 Claude。
		expect(resolveModelFamily("anthropic/vllm-qwen3.8-27b")).toBe("Qwen");
		expect(resolveModelFamily("anthropic/qwen3.6-27b")).toBe("Qwen");
		expect(resolveModelFamily("anthropic/glm-4.7-anthropic")).toBe("GLM");
		expect(resolveModelFamily("anthropic/mimo-v2.5-anthropic")).toBe("MiMo");
		expect(resolveModelFamily("strata-qwen3.8-flash-next")).toBe("Qwen");
		expect(resolveModelFamily("openai/gpt-oss-120b")).toBe("OpenAI");
		// 名字开头就是品牌时以开头为准，别被后面的装饰词带走。
		expect(resolveModelFamily("deepseek-v4.1-flash-anthropic")).toBe("DeepSeek");
		// 纯协议前缀 + 认不出的名字仍然是未知品牌，不再兜底成 Claude。
		expect(resolveModelFamily("anthropic/some-internal-model")).toBeUndefined();
		expect(resolveModelFamily("anthropic/")).toBeUndefined();
	});

	it("recognizes the other real short forms each brand ships", () => {
		expect(resolveModelFamily("sora")).toBe("OpenAI");
		expect(resolveModelFamily("sora-2")).toBe("OpenAI");
		// MiniMax 旧系列用 abab 前缀。
		expect(resolveModelFamily("abab6.5")).toBe("MiniMax");
		// 混元的中文名。
		expect(resolveModelFamily("混元")).toBe("Hunyuan");
		expect(resolveModelFamily("混元-turbo")).toBe("Hunyuan");
	});
});
