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

		it('解析 "mimo/mimo-v2.5-pro" 返回 MiMoProvider 实例', () => {
			const provider = registry.getProvider("mimo/mimo-v2.5-pro");
			expect(provider).toBeInstanceOf(MiMoProvider);
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
});
