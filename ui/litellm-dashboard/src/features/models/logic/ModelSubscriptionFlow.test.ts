import { describe, expect, it } from "vitest";
import { prepareModelCreate, providerModelName, selectedModelMappings } from "./ModelCreateLogic";
import { createModelEditDraft, prepareModelUpdate } from "./ModelEditLogic";
import { providerSelectOptions } from "./ModelProviderLogic";
import type { ProviderMetadata } from "../support/ModelModels";
import type { ProxyModel } from "../support/ModelModels";

const catalog: ProviderMetadata[] = [
	{ provider: "Anthropic", provider_display_name: "Anthropic", litellm_provider: "anthropic", credential_fields: [] },
	{ provider: "OpenAI", provider_display_name: "OpenAI", litellm_provider: "openai", credential_fields: [] },
	{
		provider: "Codex Subscription",
		provider_display_name: "Codex Subscription",
		litellm_provider: "codex-subscription",
		credential_fields: [],
	},
	{
		provider: "CommandCode",
		provider_display_name: "CommandCode",
		litellm_provider: "commandcode",
		credential_fields: [],
	},
	{
		provider: "OpenCode Go",
		provider_display_name: "OpenCode Go",
		litellm_provider: "opencode-go",
		credential_fields: [],
	},
	{
		provider: "CLIProxy",
		provider_display_name: "CLIProxy API (Managed)",
		litellm_provider: "cliproxy",
		credential_fields: [],
	},
];

describe("subscription model form behaviour", () => {
	it("creates canonical deployments with the upstream id and no deployment credentials", () => {
		const mappings = selectedModelMappings(["gpt-5.4-codex"], "Codex Subscription");
		expect(mappings).toEqual([{ public_name: "gpt-5.4-codex", litellm_model: "gpt-5.4-codex" }]);
		const [request] = prepareModelCreate({
			custom_llm_provider: "Codex Subscription",
			model: ["gpt-5.4-codex"],
			model_mappings: mappings,
			api_key: "must-not-be-stored",
			api_base: "https://example.invalid",
			litellm_credential_name: "unused",
			credential_name: "unused",
			model_name: undefined,
		});
		expect(request).toEqual({
			model_name: "gpt-5.4-codex",
			litellm_params: { model: "gpt-5.4-codex", custom_llm_provider: "codex-subscription" },
			model_info: {},
		});
	});

	it("keeps the user-editable public model name while using the upstream id for routing", () => {
		const custom = selectedModelMappings(["custom"], "OpenCode Go", "deepseek-v4.1-flash");
		expect(custom).toEqual([{ public_name: "deepseek-v4.1-flash", litellm_model: "deepseek-v4.1-flash" }]);
		custom[0].public_name = "team-coder";
		const [request] = prepareModelCreate({
			custom_llm_provider: "OpenCode Go",
			model: ["custom"],
			custom_model_name: "deepseek-v4.1-flash",
			model_mappings: custom,
		});
		expect(request.model_name).toBe("team-coder");
		expect(request.litellm_params).toEqual({
			model: "deepseek-v4.1-flash",
			custom_llm_provider: "opencode-go",
		});
	});

	it("does not repeat a provider prefix the upstream catalog already returned", () => {
		expect(providerModelName("commandcode/glm-5.3", "CommandCode")).toBe("glm-5.3");
		expect(providerModelName("opencode-go/deepseek-v4.1-flash", "opencode-go")).toBe("deepseek-v4.1-flash");
		expect(providerModelName("gpt-5.4-codex", "codex-subscription")).toBe("gpt-5.4-codex");
	});

	it("keeps subscription edits canonical and clears deployment credentials", () => {
		const model: ProxyModel = {
			model_name: "team-codex",
			litellm_params: {
				model: "gpt-5.4-codex",
				custom_llm_provider: "codex-subscription",
				api_base: "https://example.invalid",
				api_key: "synthetic",
			},
			model_info: { id: "deployment-1", db_model: true },
		};
		const draft = createModelEditDraft(model);
		draft.litellm_model_name = "codex-subscription/gpt-5.4-codex";
		const request = prepareModelUpdate(draft, model);
		expect(request.model_name).toBe("team-codex");
		expect(request.litellm_params).toMatchObject({
			model: "gpt-5.4-codex",
			custom_llm_provider: "codex-subscription",
			api_base: null,
			api_key: null,
			litellm_credential_name: null,
		});
	});

	it("edits the limits of an existing deployment without rewriting the stored account source or billing model", () => {
		const current: ProxyModel = {
			model_name: "team-coder",
			litellm_params: { model: "vendor/model", custom_llm_provider: "commandcode" },
			model_info: { id: "original-deployment" },
		};
		const draft = createModelEditDraft(current);
		draft.rpm = 120;
		const patch = prepareModelUpdate(draft, current).litellm_params;
		expect(patch).toMatchObject({ rpm: 120 });
		expect(patch.model).toBe("vendor/model");
		expect(patch.custom_llm_provider).toBe("commandcode");
		draft.litellm_model_name = "vendor/new-model";
		expect(prepareModelUpdate(draft, current).litellm_params.model).toBe("vendor/new-model");
	});

	it("offers subscription providers on create and edit and excludes retired options", () => {
		const createOptions = providerSelectOptions(catalog, "provider", null);
		expect(createOptions.map((option) => option.value)).not.toContain("CLIProxy");
		expect(createOptions.filter((option) => option.group === "Subscriptions").map((option) => option.value)).toEqual([
			"Codex Subscription",
			"CommandCode",
			"OpenCode Go",
		]);
		const editOptions = providerSelectOptions(catalog, "litellm_provider", "cliproxy");
		expect(editOptions.some((option) => option.value === "cliproxy")).toBe(false);
	});
});
