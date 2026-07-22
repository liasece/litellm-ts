import { ProviderRegistry, defaultProviderRegistry } from "./ProviderRegistry";
import { OpenAICompatProvider } from "./OpenAICompatProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { GLMProvider } from "./GLMProvider";
import { MiMoProvider } from "./MiMoProvider";

describe("ProviderRegistry", () => {
	let registry: ProviderRegistry;

	beforeEach(() => {
		registry = new ProviderRegistry();
	});

	describe("getProvider", () => {
		it('解析 "openai/gpt-5.4" 返回 OpenAICompatProvider 实例', () => {
			const provider = registry.getProvider("openai/gpt-5.4");
			expect(provider).toBeInstanceOf(OpenAICompatProvider);
		});

		it('解析 "anthropic/claude-sonnet-4-6" 返回 AnthropicProvider 实例', () => {
			const provider = registry.getProvider("anthropic/claude-sonnet-4-6");
			expect(provider).toBeInstanceOf(AnthropicProvider);
		});

		it('解析 "deepseek/deepseek-v4-flash" 返回 DeepSeekProvider 实例', () => {
			const provider = registry.getProvider("deepseek/deepseek-v4-flash");
			expect(provider).toBeInstanceOf(DeepSeekProvider);
		});

		it('解析 "glm/GLM-5.1" 返回 GLMProvider 实例', () => {
			const provider = registry.getProvider("glm/GLM-5.1");
			expect(provider).toBeInstanceOf(GLMProvider);
		});

		// DIFF-CFG-ZAI-02: 验证 registry 创建 GLMProvider 时传入的 apiBase 正确
		// （不是被误传到 apiKey 位置）
		it('解析 "glm/GLM-5.1" 返回的 GLMProvider 拥有正确的 apiBase', () => {
			const provider = registry.getProvider("glm/GLM-5.1") as GLMProvider;
			// 通过 OpenAICompatProvider 的 transformRequest 间接验证 apiBase 正确拼接到 URL
			const req = provider.transformRequest("GLM-5.1", [{ role: "user", content: "hi" }], {});
			expect(req.url).toContain("api.z.ai");
			expect(req.url).not.toContain("undefined");
		});

		it('解析 "mimo/mimo-v2.5-pro" 返回 MiMoProvider 实例', () => {
			const provider = registry.getProvider("mimo/mimo-v2.5-pro");
			expect(provider).toBeInstanceOf(MiMoProvider);
		});

		it('解析 "vllm/llama-3" 返回 OpenAICompatProvider 实例', () => {
			const provider = registry.getProvider("vllm/llama-3");
			expect(provider).toBeInstanceOf(OpenAICompatProvider);
		});

		it('解析 "unknown-provider/model" 抛出错误', () => {
			expect(() => registry.getProvider("unknown-provider/model")).toThrow(/unknown provider/i);
		});
	});

	describe("custom_llm_provider override", () => {
		it("通过 customProvider 参数覆盖 provider 类型", () => {
			const provider = registry.getProvider("gpt-5.4", "openai");
			expect(provider).toBeInstanceOf(OpenAICompatProvider);
		});

		it("customProvider 优先级高于模型名中的前缀", () => {
			const provider = registry.getProvider("openai/gpt-4", "anthropic");
			expect(provider).toBeInstanceOf(AnthropicProvider);
		});
	});

	describe("register", () => {
		it("注册自定义 provider 可以通过 getProvider 获取", () => {
			const customProvider = new OpenAICompatProvider("", "https://custom.api");
			registry.register("custom", customProvider);

			const retrieved = registry.getProvider("custom/model");
			expect(retrieved).toBe(customProvider);
		});
	});

	describe("defaultProviderRegistry", () => {
		it("默认单例可以正常获取 provider", () => {
			const provider = defaultProviderRegistry.getProvider("openai/gpt-5");
			expect(provider).toBeInstanceOf(OpenAICompatProvider);
		});
	});

	describe("deployment litellm_params 透传", () => {
		it("getProvider 传入 api_base 后，AnthropicProvider.transformRequest URL 使用该 base", () => {
			const provider = registry.getProvider("anthropic/claude-sonnet-4-6", undefined, {
				api_base: "http://upstream.test",
				api_key: "sk-x",
			});
			expect(provider).toBeInstanceOf(AnthropicProvider);
			const req = provider.transformRequest("claude-sonnet-4-6", [{ role: "user", content: "hi" }], {});
			expect(req.url).toBe("http://upstream.test/v1/messages");
		});

		it("OpenAICompatProvider 接收 deployment api_base 后 URL 使用该 base", () => {
			const provider = registry.getProvider("openai/gpt-5.5", undefined, {
				api_base: "http://upstream.test",
				api_key: "sk-x",
			});
			expect(provider).toBeInstanceOf(OpenAICompatProvider);
			const req = provider.transformRequest("gpt-5.5", [{ role: "user", content: "hi" }], {});
			expect(req.url).toBe("http://upstream.test/chat/completions");
		});

		it("deployment.api_key 优先于 proxy header api_key", () => {
			const provider = registry.getProvider("openai/gpt-5", undefined, {
				api_key: "sk-deployment",
				headers: { "x-litellm-api-key": "sk-proxy" },
			});
			expect(provider).toBeInstanceOf(OpenAICompatProvider);
			const req = provider.transformRequest("gpt-5", [{ role: "user", content: "hi" }], {});
			expect(req.headers["Authorization"]).toBe("Bearer sk-deployment");
		});

		it("未传 api_base 时使用 provider 默认 base", () => {
			const provider = registry.getProvider("anthropic/claude-sonnet-4-6");
			expect(provider).toBeInstanceOf(AnthropicProvider);
			const req = provider.transformRequest("claude-sonnet-4-6", [{ role: "user", content: "hi" }], {});
			expect(req.url).toBe("https://api.anthropic.com/v1/messages");
		});
	});
});
