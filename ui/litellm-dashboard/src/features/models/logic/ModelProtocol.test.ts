import { describe, it, expect } from "vitest";
import { prepareModelCreate } from "./ModelCreateLogic";
import { createModelEditDraft, prepareModelUpdate } from "./ModelEditLogic";
import { createCredentialPayload, updateCredentialPayload } from "./CredentialPayloadLogic";
import { createAutoRouter } from "./AutoRouterLogic";
import { resolveAliasPath } from "./AliasResolutionLogic";
import { transformModels } from "./ModelDataLogic";
import { createPassThroughDraft, passThroughPayload } from "../support/PassThroughModels";
import type { ProxyModel, ModelCredential } from "../support/ModelModels";
const current: ProxyModel = {
	model_name: "research",
	litellm_params: { model: "openai/gpt-4.1", custom_llm_provider: "openai", api_base: "https://api.example.test", temperature: 0.25 },
	model_info: {
		id: "deployment-1",
		db_model: true,
		input_cost_per_token: 0.000002,
		output_cost_per_token: 0.000008,
		access_groups: ["research"],
		custom: "preserved",
	},
};
describe("Models protocol contracts", () => {
	it("converts USD / 1M prices once for every deployment in a batch", () => {
		const source = {
			custom_llm_provider: "OpenAI",
			model: ["gpt-4.1", "gpt-4.1-mini"],
			model_mappings: [
				{ public_name: "research", litellm_model: "gpt-4.1" },
				{ public_name: "research-mini", litellm_model: "gpt-4.1-mini" },
			],
			input_cost_per_token: "2",
			output_cost_per_token: "8",
			mode: "chat",
		};
		const requests = prepareModelCreate(source);
		expect(requests.map((request) => request.litellm_params.input_cost_per_token)).toEqual([0.000002, 0.000002]);
		expect(requests.map((request) => request.litellm_params.output_cost_per_token)).toEqual([0.000008, 0.000008]);
		expect(requests.map((request) => request.model_info)).toEqual([{ mode: "chat" }, { mode: "chat" }]);
		expect(source.input_cost_per_token).toBe("2");
	});
	it("keeps the selected upstream model when the provider reset leaves an undefined optional name", () => {
		const [request] = prepareModelCreate({
			custom_llm_provider: "OpenAI",
			model: ["gpt-4.1"],
			model_name: undefined,
			model_mappings: [{ public_name: "Acceptance main", litellm_model: "gpt-4.1" }],
		});
		expect(request.litellm_params.model).toBe("gpt-4.1");
		const draft = createModelEditDraft(current);
		expect(prepareModelUpdate(draft, current).model_info).not.toHaveProperty("health_check_model");
	});
	it("preserves zero prices and keeps managed CLIProxy credentials out of new models", () => {
		const [request] = prepareModelCreate({
			custom_llm_provider: "CLIProxy",
			model: ["all-wildcard"],
			model_mappings: [],
			api_key: "synthetic",
			api_base: "https://api.example.test",
			litellm_credential_name: "unused",
			credential_name: "unused",
			input_cost_per_token: 0,
			model_access_group: ["research"],
			team_id: "team-1",
		});
		expect(request).toEqual({
			model_name: "cliproxy/*",
			litellm_params: { model: "cliproxy/*", custom_llm_provider: "cliproxy", input_cost_per_token: 0 },
			model_info: { access_groups: ["research"], team_id: "team-1" },
		});
	});
	it("does not let extra JSON replace a selected reusable credential", () => {
		const [request] = prepareModelCreate({
			custom_llm_provider: "OpenAI",
			model_mappings: [{ public_name: "research", litellm_model: "gpt-4.1" }],
			litellm_credential_name: "chosen",
			litellm_extra_params: JSON.stringify({ litellm_credential_name: "ignored", timeout: 30 }),
			model_info_params: JSON.stringify({ mode: "chat", owner: "research" }),
		});
		expect(request.litellm_params).toMatchObject({ litellm_credential_name: "chosen", timeout: 30 });
		expect(request.model_info).toEqual({ mode: "chat", owner: "research" });
	});
	it("preserves manual secrets when untouched and retains unknown model fields on editing", () => {
		const draft = createModelEditDraft(current);
		const request = prepareModelUpdate(draft, current);
		expect(request.litellm_params).toMatchObject({
			temperature: 0.25,
			input_cost_per_token: 0.000002,
			output_cost_per_token: 0.000008,
			litellm_credential_name: null,
		});
		expect(request.litellm_params).not.toHaveProperty("api_key");
		expect(request.model_info).toMatchObject({
			custom: "preserved",
			override_model_name: null,
			override_reasoning_effort: null,
			access_groups: ["research"],
			enabled_builtin_capabilities: [],
		});
	});
	it("requires a replacement before a reused credential can become manual", () => {
		const reused = { ...current, litellm_params: { ...current.litellm_params, litellm_credential_name: "saved" } };
		const draft = createModelEditDraft(reused);
		draft.litellm_credential_name = "";
		draft.api_key = "";
		expect(() => prepareModelUpdate(draft, reused)).toThrow("Enter a new API key before switching to Manual credentials");
		draft.api_key = " synthetic-replacement ";
		expect(prepareModelUpdate(draft, reused).litellm_params).toMatchObject({
			litellm_credential_name: null,
			api_key: "synthetic-replacement",
		});
	});
	it("rejects invalid edit JSON and prevents raw JSON from overwriting explicit secret controls", () => {
		const draft = createModelEditDraft(current);
		draft.litellm_extra_params = "{ invalid";
		expect(() => prepareModelUpdate(draft, current)).toThrow("Invalid JSON in LiteLLM Params");
		draft.litellm_extra_params = JSON.stringify({ api_key: "ignored", litellm_credential_name: "ignored", temperature: 0.5 });
		draft.delete_api_key = true;
		expect(prepareModelUpdate(draft, current).litellm_params).toMatchObject({
			api_key: null,
			litellm_credential_name: null,
			temperature: 0.5,
		});
	});
	it("patches only touched credential values and sends explicit null for deleted stored secrets", () => {
		const credential: ModelCredential = {
			credential_name: "saved",
			credential_values: { api_key: "****masked", api_base: "https://old.example.test" },
			credential_info: { custom_llm_provider: "OpenAI" },
		};
		const payload = updateCredentialPayload(
			{ credential_name: "saved", custom_llm_provider: "OpenAI", api_key: "****masked", api_base: "https://new.example.test" },
			new Set(["api_key", "api_base"]),
			credential,
			["api_key"],
		);
		expect(payload).toEqual({ credential_values: { api_base: "https://new.example.test", api_key: null } });
		expect(
			createCredentialPayload({
				credential_name: "new",
				custom_llm_provider: "OpenAI",
				api_key: "synthetic",
				blank: "",
				absent: null,
			}),
		).toEqual({
			credential_name: "new",
			credential_values: { api_key: "synthetic" },
			credential_info: { custom_llm_provider: "OpenAI" },
		});
	});
	it("serializes semantic routes as JSON and complexity tiers as an object", () => {
		const tiers = { SIMPLE: "small", MEDIUM: "medium", COMPLEX: "large", REASONING: "reasoner" };
		const complexity = createAutoRouter({ auto_router_name: "smart", model_access_group: ["research"] }, "complexity", tiers, []);
		expect(complexity.litellm_params).toEqual({
			model: "auto_router/complexity_router",
			complexity_router_config: { tiers },
			complexity_router_default_model: "medium",
		});
		const semantic = createAutoRouter(
			{ auto_router_name: "semantic", auto_router_default_model: "medium", auto_router_embedding_model: "embeddings" },
			"semantic",
			tiers,
			[{ id: "route-1", name: "small", utterances: ["hello"], description: "Greetings", score_threshold: 0.5 }],
		);
		expect(JSON.parse(String(semantic.litellm_params.auto_router_config))).toEqual({
			routes: [{ name: "small", utterances: ["hello"], description: "Greetings", score_threshold: 0.5 }],
		});
		expect(semantic.litellm_params.auto_router_embedding_model).toBe("embeddings");
	});
	it("resolves aliases through daily schedules and reports cycles without making a health request", () => {
		const aliases = {
			research: { model: "large", timezone: "Asia/Shanghai", schedule: [{ start: "09:00", end: "18:00", model: "small" }] },
			cycleA: "cycleB",
			cycleB: "cycleA",
		};
		expect(resolveAliasPath("research", aliases, new Set(["small", "large"]), new Date("2026-11-07T02:00:00Z"))).toMatchObject({
			resolvedModel: "small",
			reachable: true,
			path: ["research", "small"],
		});
		expect(resolveAliasPath("research", aliases, new Set(["small", "large"]), new Date("2026-11-07T14:00:00Z"))).toMatchObject({
			resolvedModel: "large",
			reachable: true,
		});
		expect(resolveAliasPath("cycleA", aliases, new Set(["small"]))).toMatchObject({
			reachable: false,
			error: "Alias cycle: cycleA → cycleB → cycleA",
		});
	});
	it("keeps passthrough update authentication premium-scoped and omits empty method/guardrail overrides", () => {
		const draft = createPassThroughDraft({
			id: "endpoint-1",
			path: "/research",
			target: "https://api.example.test",
			headers: { "X-Test": "synthetic" },
			include_subpath: true,
			auth: true,
			methods: ["POST"],
		});
		draft.methods = [];
		draft.guardrails = {};
		const value = JSON.parse(JSON.stringify(passThroughPayload(draft, false, true)));
		expect(value).toEqual({
			path: "/research",
			target: "https://api.example.test",
			headers: { "X-Test": "synthetic" },
			include_subpath: true,
		});
		draft.headersText = "{ invalid";
		expect(() => passThroughPayload(draft, true, true)).toThrow("Invalid JSON format for headers");
	});
	it("retains zero model prices when transforming display data", () => {
		const [model] = transformModels(
			[{ ...current, model_info: { ...current.model_info, input_cost_per_token: 0, output_cost_per_token: 0 } }],
			{},
		);
		expect(model.input_cost).toBe(0);
		expect(model.output_cost).toBe(0);
		expect(current.model_info.input_cost_per_token).toBe(0.000002);
	});
});
