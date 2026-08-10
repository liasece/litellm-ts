import { ModelsController } from "./ModelsEndpoint";
import { Router } from "../router/Router";
import { RoutingStrategyName } from "../types/router";
import { dbConfigProvider } from "../core/config/DbConfigProvider";

function makeController(): { controller: ModelsController; router: Router } {
	const router = new Router({
		model_list: [
			{
				model_name: "secure-model",
				litellm_params: {
					model: "openai/gpt-4o",
					api_key: "sk-model-secret",
					api_token: "token-secret",
					max_tokens: 1024,
					extra_headers: { Authorization: "Bearer header-secret", "x-api-key": "nested-api-key" },
				},
				model_info: { id: "deployment-1", password: "model-info-secret" } as never,
			},
		],
		routing_strategy: RoutingStrategyName.SimpleShuffle,
		num_retries: 0,
	});
	return { controller: new ModelsController(router), router: router };
}

describe("ModelsEndpoint 单模型详情安全响应", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it.each(["long", "short"] as const)("%s 路径递归掩码秘密且不修改 Router deployment", async (pathKind) => {
		const { controller, router } = makeController();
		const req = { params: { model_id: "secure-model" } } as never;
		const response = pathKind === "long" ? await controller.getModel(req) : await controller.getModelShort(req);
		const serialized = JSON.stringify(response);

		expect(serialized).not.toContain("sk-model-secret");
		expect(serialized).not.toContain("token-secret");
		expect(serialized).not.toContain("header-secret");
		expect(serialized).not.toContain("nested-api-key");
		expect(serialized).not.toContain("model-info-secret");
		expect(response.litellm_params.api_key).toBe("********");
		expect(response.litellm_params.api_token).toBe("********");
		expect(response.litellm_params.max_tokens).toBe(1024);
		expect(response.litellm_params.extra_headers).toEqual({ Authorization: "********", "x-api-key": "********" });
		expect((response.model_info as Record<string, unknown>).password).toBe("********");

		const deployment = router.getDeployments()[0]!;
		expect(deployment.litellm_params.api_key).toBe("sk-model-secret");
		expect(deployment.litellm_params.api_token).toBe("token-secret");
		expect(deployment.litellm_params.extra_headers?.Authorization).toBe("Bearer header-secret");
		expect((deployment.model_info as Record<string, unknown>).password).toBe("model-info-secret");
	});

	it("在模型列表和详情中把已启用的内置视觉报告为图片输入能力", async () => {
		jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({
			vision: { enabled: true, handler_model: "vision-worker" },
		});
		const router = new Router({
			model_list: [
				{
					model_name: "text-with-vision",
					litellm_params: { model: "deepseek/text-model" },
					model_info: {
						supports_vision: false,
						supports_function_calling: true,
						enabled_builtin_capabilities: ["vision"],
					},
				},
			],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
		});
		const controller = new ModelsController(router);

		const list = await controller.listModels();
		expect(list.data).toEqual([
			expect.objectContaining({
				id: "text-with-vision",
				supports_vision: true,
				input_modalities: ["text", "image"],
			}),
		]);
		expect(list.models).toEqual([
			expect.objectContaining({
				slug: "text-with-vision",
				input_modalities: ["text", "image"],
			}),
		]);
		expect(list.models[0]?.base_instructions.length).toBeGreaterThan(1_000);

		const detail = await controller.getModel({ params: { model_id: "text-with-vision" } } as never);
		expect(detail.model_info?.supports_vision).toBe(true);
		expect(router.getDeployments()[0]?.model_info?.supports_vision).toBe(false);
	});
});
