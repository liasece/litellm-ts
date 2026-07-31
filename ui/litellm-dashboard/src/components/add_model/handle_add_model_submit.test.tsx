import { describe, expect, it, vi } from "vitest";
import { prepareModelAddRequest } from "./handle_add_model_submit";

vi.mock("../molecules/notifications_manager", () => ({
	default: {
		fromBackend: vi.fn(),
	},
}));

describe("prepareModelAddRequest", () => {
	it("returns deployment data for the most basic form", async () => {
		const formValues = {
			model_mappings: [
				{
					public_name: "Public Model",
					litellm_model: "litellm/public",
				},
			],
			model_name: "custom-model-name",
			base_model: "gpt-4",
			team_id: "team-123",
			model_access_group: ["group-1"],
			input_cost_per_token: "2000000",
			output_cost_per_token: "1000000",
		};

		const deployments = await prepareModelAddRequest({ ...formValues }, "token", null);

		expect(deployments).toHaveLength(1);
		const [deployment] = deployments!;
		expect(deployment.modelName).toBe("Public Model");
		expect(deployment.litellmParamsObj.model).toBe("custom-model-name");
		expect(deployment.litellmParamsObj.input_cost_per_token).toBe(2);
		expect(deployment.litellmParamsObj.output_cost_per_token).toBe(1);
		expect(deployment.modelInfoObj.base_model).toBe("gpt-4");
		expect(deployment.modelInfoObj.access_groups).toEqual(["group-1"]);
		expect(deployment.modelInfoObj.team_id).toBe("team-123");
	});

	it("passes Anthropic api_base through to litellm_params", async () => {
		const formValues = {
			model_mappings: [
				{
					public_name: "Anthropic Model",
					litellm_model: "anthropic/claude-sonnet-4-20250514",
				},
			],
			model_name: "anthropic/claude-sonnet-4-20250514",
			custom_llm_provider: "Anthropic",
			api_base: "https://anthropic.internal.example",
			api_key: "sk-ant-test",
		};

		const deployments = await prepareModelAddRequest({ ...formValues }, "token", null);

		expect(deployments).toHaveLength(1);
		expect(deployments![0].litellmParamsObj.api_base).toBe("https://anthropic.internal.example");
	});

	it("uses a lowercase fallback for unrecognized custom providers", async () => {
		const fallbackValues = {
			model_mappings: [
				{
					public_name: "Petals Model",
					litellm_model: "petals/model",
				},
			],
			model_name: "petals/model",
			custom_llm_provider: "Petals",
		};

		const deployments = await prepareModelAddRequest({ ...fallbackValues }, "token", null);

		expect(deployments).toHaveLength(1);
		const [deployment] = deployments!;
		expect(deployment.litellmParamsObj.custom_llm_provider).toBe("petals");
	});

	it("ignores litellm_credential_name inside LiteLLM Params JSON", async () => {
		const formValues = {
			model_mappings: [
				{
					public_name: "Public Model",
					litellm_model: "litellm/public",
				},
			],
			model_name: "custom-model-name",
			litellm_credential_name: "selected-credential",
			litellm_extra_params: JSON.stringify({
				litellm_credential_name: "from-json",
				timeout: 5,
			}),
		};

		const deployments = await prepareModelAddRequest({ ...formValues }, "token", null);

		expect(deployments).toHaveLength(1);
		const [deployment] = deployments!;
		expect(deployment.litellmParamsObj.litellm_credential_name).toBe("selected-credential");
		expect(deployment.litellmParamsObj.timeout).toBe(5);
	});

	it("removes deployment credentials and endpoint overrides for the managed CLIProxy provider", async () => {
		const deployments = await prepareModelAddRequest(
			{
				model_mappings: [{ public_name: "codex", litellm_model: "cliproxy/gpt-5.4" }],
				custom_llm_provider: "CLIProxy",
				litellm_credential_name: "legacy-cli-proxy",
				credential_name: "legacy-cli-proxy",
				api_base: "http://legacy.example",
				api_key: "legacy-secret",
			},
			"token",
			null,
		);

		expect(deployments).toHaveLength(1);
		expect(deployments![0].litellmParamsObj).toMatchObject({
			model: "cliproxy/gpt-5.4",
			custom_llm_provider: "cliproxy",
		});
		expect(deployments![0].litellmParamsObj).not.toHaveProperty("litellm_credential_name");
		expect(deployments![0].litellmParamsObj).not.toHaveProperty("credential_name");
		expect(deployments![0].litellmParamsObj).not.toHaveProperty("api_base");
		expect(deployments![0].litellmParamsObj).not.toHaveProperty("api_key");
	});
});
