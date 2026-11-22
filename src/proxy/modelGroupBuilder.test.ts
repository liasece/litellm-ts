import { normalizeBuiltinCapabilitiesConfig } from "../capabilities/BuiltinCapabilitiesConfig";
import { modelCostMapService } from "../cost/ModelCostMapService";
import type { Deployment } from "../types/router";
import { buildEnrichedModelInfo, buildModelGroupInfoResponse } from "./modelGroupBuilder";

describe("effective model capabilities", () => {
	const deployment: Deployment = {
		model_name: "text-with-vision",
		litellm_params: { model: "deepseek/text-model" },
		model_info: {
			supports_vision: false,
			supports_function_calling: true,
			enabled_builtin_capabilities: ["vision"],
		},
	};
	const capabilities = normalizeBuiltinCapabilitiesConfig({
		vision: { enabled: true, handler_model: "vision-worker" },
	});

	it("projects built-in vision into detailed model metadata", () => {
		const info = buildEnrichedModelInfo(deployment, "deployment-id", {}, capabilities);
		expect(info["supports_vision"]).toBe(true);
	});

	it("projects built-in vision into model group metadata", () => {
		const response = buildModelGroupInfoResponse([deployment], {}, capabilities);
		expect(response.data).toEqual([expect.objectContaining({ model_group: "text-with-vision", supports_vision: true })]);
	});
});

describe("订阅渠道模型价格", () => {
	// 生产里混元短名 hy4-flash 指向 OpenCode Go 的 hy4-flash-free；上游价格快照没有这一行，
	// 缺补丁时 /model_group/info 返回 null，dashboard 会显示空价。
	const deployment: Deployment = {
		model_name: "hy4-flash",
		litellm_params: { model: "hy4-flash-free", custom_llm_provider: "opencode-go" },
	};

	it("混元 Free 档按 0 价返回，而不是 null", () => {
		const response = buildModelGroupInfoResponse([deployment], modelCostMapService.getSnapshot().map);
		expect(response.data).toEqual([
			expect.objectContaining({ model_group: "hy4-flash", input_cost_per_token: 0, output_cost_per_token: 0, mode: "chat" }),
		]);
	});

	it("hy4 正式版按官方 $0.834 / $2.501 每百万 tokens 折算", () => {
		const paid: Deployment = { model_name: "hy4", litellm_params: { model: "hy4", custom_llm_provider: "opencode-go" } };
		const response = buildModelGroupInfoResponse([paid], modelCostMapService.getSnapshot().map);
		expect(response.data[0]).toMatchObject({ input_cost_per_token: 8.34e-7, output_cost_per_token: 2.501e-6 });
	});
});
