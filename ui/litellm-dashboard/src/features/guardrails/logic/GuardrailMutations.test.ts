import { populateGuardrailProviders } from "./GuardrailProviderLogic";
import { describe, it, expect } from "vitest";
import { buildGuardrailCreatePayload, emptyGuardrailContent, emptyToolPermissions } from "./GuardrailCreateLogic";
import { contentFromGuardrail, formatGuardrailContent } from "./GuardrailContentLogic";
import { buildGuardrailUpdatePayload, toolPermissionsFromGuardrail } from "./GuardrailUpdateLogic";
import { customGuardrailPayload, guardrailTestInputType, normalizeGuardrailModes } from "./GuardrailCustomCodeLogic";
import { addStaticHeader, addForwardHeader, submissionToGuardrail, formatSubmissionDate } from "./GuardrailSubmissionLogic";
import { buildEquivalentConfigYaml } from "./GuardrailSubmissionYamlLogic";
import type { GuardrailRecord, GuardrailProviderParameters } from "../support/GuardrailModels";
const record = (): GuardrailRecord => ({
		guardrail_id: "synthetic/id",
		guardrail_name: "Example",
		litellm_params: {
			guardrail: "presidio",
			mode: ["pre_call"],
			default_on: false,
			api_base: "https://example.test",
			pii_entities_config: { EMAIL_ADDRESS: "MASK" },
		},
		guardrail_info: { description: "Synthetic" },
	}),
	values = (data: GuardrailRecord) => ({
		guardrail_name: data.guardrail_name,
		...data.litellm_params,
		guardrail_info: JSON.stringify(data.guardrail_info),
	}),
	providers: GuardrailProviderParameters = {
		presidio: { api_base: { type: "str" }, threshold: { type: "float" }, optional_params: { fields: { enabled: { type: "bool" } } } },
	};
function update(data = record(), form: Record<string, unknown> = values(data)) {
	return buildGuardrailUpdatePayload(
		data,
		form,
		providers,
		["EMAIL_ADDRESS"],
		{ EMAIL_ADDRESS: "MASK" },
		emptyGuardrailContent(),
		false,
		emptyToolPermissions(),
		false,
	);
}
describe("Guardrail API mutation compatibility", () => {
	it("omits unchanged data and sends only a changed scalar field", () => {
		expect(update()).toEqual({});
		const data = record();
		expect(update(data, { ...values(data), default_on: true })).toEqual({ litellm_params: { default_on: true } });
	});
	it("clears recognized provider settings with null and ignores unknown form fields", () => {
		const data = record();
		expect(update(data, { ...values(data), api_base: "", unknown: "must not leak" })).toEqual({ litellm_params: { api_base: null } });
	});
	it("keeps false and zero optional values and flattens recognized provider keys", () => {
		const data = record();
		expect(update(data, { ...values(data), threshold: 0, optional_params: { enabled: false } })).toEqual({
			litellm_params: { threshold: 0, enabled: false },
		});
	});
	it("rebuilds PII entity selections and sends an empty object when the last entity is removed", () => {
		const data = record();
		expect(
			buildGuardrailUpdatePayload(
				data,
				values(data),
				providers,
				[],
				{},
				emptyGuardrailContent(),
				false,
				emptyToolPermissions(),
				false,
			),
		).toEqual({ litellm_params: { pii_entities_config: {} } });
	});
	it("preserves old empty metadata omission semantics and rejects malformed JSON before a mutation", () => {
		const data = record(),
			body = update(data, { ...values(data), guardrail_info: "" });
		expect(Object.keys(body)).toEqual(["guardrail_info"]);
		expect(JSON.stringify(body)).toBe("{}");
		expect(() => update(data, { ...values(data), guardrail_info: "{broken" })).toThrow();
	});
	it("sends explicit empty content arrays and null to remove competitor intent", () => {
		const data = record();
		data.litellm_params.guardrail = "litellm_content_filter";
		delete data.litellm_params.pii_entities_config;
		const body = buildGuardrailUpdatePayload(
			data,
			values(data),
			null,
			[],
			{},
			emptyGuardrailContent(),
			true,
			emptyToolPermissions(),
			false,
		);
		expect(body).toEqual({ litellm_params: { patterns: [], blocked_words: [], categories: [], competitor_intent_config: null } });
	});
	it("normalizes tool permission defaults and clears a removed violation message with null", () => {
		const data = record();
		data.litellm_params = {
			guardrail: "tool_permission",
			mode: "pre_call",
			default_on: false,
			default_action: "DENY",
			on_disallowed_action: "BLOCK",
			rules: [{ id: "one", decision: "deny" }],
			violation_message_template: "Old",
		};
		const config = toolPermissionsFromGuardrail(data);
		expect(config.default_action).toBe("deny");
		config.violation_message_template = "";
		expect(buildGuardrailUpdatePayload(data, values(data), null, [], {}, emptyGuardrailContent(), false, config, false)).toEqual({
			litellm_params: {
				rules: config.rules,
				default_action: "deny",
				on_disallowed_action: "block",
				violation_message_template: null,
			},
		});
	});
	it("preserves content normalization defaults and keeps category edits valid when metadata has not loaded", () => {
		const data = record();
		data.litellm_params.patterns = [{ pattern_type: "regex", name: "internal", pattern: "ID-[0-9]+", action: "MASK" }];
		data.litellm_params.blocked_words = [{ keyword: "synthetic" }];
		data.litellm_params.categories = [{ category: "topic" }];
		const content = contentFromGuardrail(data, null);
		expect(content.categories[0]).toMatchObject({ display_name: "topic", action: "BLOCK", severity_threshold: "medium" });
		expect(formatGuardrailContent(content)).toMatchObject({
			patterns: [{ pattern_type: "regex", pattern: "ID-[0-9]+", name: "internal", action: "MASK" }],
			blocked_words: [{ keyword: "synthetic", action: "BLOCK" }],
			categories: [{ category: "topic", enabled: true, severity_threshold: "medium" }],
		});
	});
	it("validates required content filter configuration before constructing a create request", () => {
		populateGuardrailProviders({ litellm_content_filter: { ui_friendly_name: "LiteLLM Content Filter" } });
		expect(() =>
			buildGuardrailCreatePayload(
				{ provider: "LitellmContentFilter" },
				null,
				emptyGuardrailContent(),
				[],
				{},
				emptyToolPermissions(),
				{ type: "", onViolation: "warn", message: "", open: false },
			),
		).toThrow("Please configure at least one content filter setting");
	});
	it("chooses request mode ahead of response mode and updates custom code without rewriting unchanged fields", () => {
		expect(normalizeGuardrailModes([])).toEqual(["pre_call"]);
		expect(normalizeGuardrailModes("post_call")).toEqual(["post_call"]);
		expect(guardrailTestInputType(["post_call", "pre_mcp_call"])).toBe("request");
		expect(guardrailTestInputType(["post_mcp_call"])).toBe("response");
		const data = record();
		expect(customGuardrailPayload("Example", " raw code ", ["pre_call"], false, data)).toEqual({
			litellm_params: { custom_code: " raw code " },
		});
	});
});
describe("Submitted guardrail headers and equivalent configuration", () => {
	it("accepts list and object header responses and uses UTC dates without changing invalid input", () => {
		const row = submissionToGuardrail({
			guardrail_id: "id",
			guardrail_name: "Example",
			status: "pending_review",
			litellm_params: { headers: [{ name: "X-Example", value: 0 }], extra_headers: ["x-client", 7] },
			submitted_at: "2026-11-07T01:00:00+08:00",
		});
		expect(row).toMatchObject({
			status: "pending",
			forwardKey: true,
			submittedAt: "2026-11-06",
			customHeaders: [{ key: "X-Example", value: "0" }],
			extraHeaders: ["x-client"],
		});
		expect(formatSubmissionDate("not a date")).toBe("not a date");
	});
	it("rejects duplicate headers case-insensitively and normalizes only newly added client names", () => {
		expect(addStaticHeader([{ key: "X-Example", value: "old" }], " x-example ", "new")).toBeNull();
		expect(addStaticHeader([], " X-Example ", " value ")).toEqual([{ key: "X-Example", value: "value" }]);
		expect(addForwardHeader(["X-Request-Id"], "x-request-id")).toBeNull();
		expect(addForwardHeader(["Original-Case"], " X-New ")).toEqual(["Original-Case", "x-new"]);
	});
	it("escapes static YAML header quotes and preserves the existing provider-specific scalar rendering", () => {
		const row = submissionToGuardrail({
			guardrail_id: "id",
			guardrail_name: "Example",
			status: "active",
			litellm_params: {
				api_base: "https://example.test",
				headers: { "X-Note": 'a "quote"' },
				extra_headers: ["x-request-id"],
				additional_provider_specific_params: { enabled: false, limit: 0 },
			},
		});
		const yaml = buildEquivalentConfigYaml(row);
		expect(yaml).toContain(String.raw`X-Note: "a \"quote\""`);
		expect(yaml).toContain("enabled: false");
		expect(yaml).toContain("limit: 0");
		expect(yaml).toContain("- x-request-id");
	});
});
