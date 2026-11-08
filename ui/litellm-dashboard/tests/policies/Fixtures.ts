export const policyFixtureBase = {
	policy_id: "fixture-base-v1",
	policy_name: "global-baseline",
	description: "Protect company requests against prompt injection",
	inherit: null,
	guardrails_add: ["fixture-injection"],
	guardrails_remove: [],
	condition: null,
	version_number: 1,
	version_status: "production",
	created_at: "2026-11-06T02:00:00Z",
	updated_at: "2026-11-07T02:00:00Z",
};
export const policyFixtureDraft = {
	...policyFixtureBase,
	policy_id: "fixture-base-v2",
	version_number: 2,
	version_status: "draft",
	pipeline: {
		mode: "pre_call",
		steps: [{ guardrail: "fixture-injection", on_pass: "next", on_fail: "block", pass_data: false, modify_response_message: null }],
	},
};
export const policyFixtureChild = {
	...policyFixtureBase,
	policy_id: "fixture-health-v1",
	policy_name: "healthcare-compliance",
	description: "Apply healthcare privacy requirements",
	inherit: "global-baseline",
	guardrails_add: ["fixture-pii", "fixture-topic"],
	guardrails_remove: [],
	condition: { model: "gpt-4.*" },
	version_number: 1,
};
export const policyFixtureGuardrails = [
	{
		guardrail_name: "fixture-injection",
		guardrail_id: "fixture-guardrail-injection",
		litellm_params: { guardrail: "litellm_content_filter", mode: "pre_call", default_on: false },
		guardrail_info: { description: "Block prompt injection attempts" },
	},
	{
		guardrail_name: "fixture-pii",
		guardrail_id: "fixture-guardrail-pii",
		litellm_params: { guardrail: "presidio", mode: "pre_call", default_on: false },
		guardrail_info: { description: "Mask sensitive personal information" },
	},
	{
		guardrail_name: "fixture-topic",
		guardrail_id: "fixture-guardrail-topic",
		litellm_params: { guardrail: "litellm_content_filter", mode: "pre_call", default_on: false },
		guardrail_info: { description: "Block restricted topics" },
	},
];
const definition = {
	guardrail_name: "fixture-new-filter",
	litellm_params: {
		guardrail: "litellm_content_filter",
		mode: "pre_call",
		patterns: [{ pattern: "fixture", action: "BLOCK" }],
		default_on: false,
	},
	guardrail_info: { description: "Filter unsafe content" },
};
export const policyFixtureTemplates = [
	{
		id: "fixture-security",
		title: "Security Baseline",
		description: "Protect against prompt injection and unsafe content.",
		icon: "ShieldCheckIcon",
		iconColor: "text-blue-600",
		iconBg: "bg-blue-50",
		guardrails: ["fixture-injection", "fixture-new-filter"],
		tags: ["Security", "General"],
		complexity: "Low",
		estimated_latency_ms: 1,
		guardrailDefinitions: [policyFixtureGuardrails[0], definition],
		templateData: {
			policy_name: "security-baseline",
			description: "Protect all company requests",
			guardrails_add: ["fixture-injection", "fixture-new-filter"],
			guardrails_remove: [],
		},
	},
	{
		id: "fixture-healthcare",
		title: "Healthcare Privacy",
		description: "Apply privacy controls for healthcare requests.",
		icon: "ShieldExclamationIcon",
		iconColor: "text-purple-600",
		iconBg: "bg-purple-50",
		guardrails: ["fixture-pii"],
		tags: ["Privacy", "Healthcare"],
		inherits: "global-baseline",
		complexity: "Medium",
		parameters: [{ name: "department", label: "Department", type: "text", required: true, placeholder: "e.g. Patient Support" }],
		guardrailDefinitions: [policyFixtureGuardrails[1]],
		templateData: {
			policy_name: "healthcare-privacy",
			description: "Protect {{department}} requests",
			inherit: "global-baseline",
			guardrails_add: ["fixture-pii"],
			guardrails_remove: [],
		},
	},
	{
		id: "fixture-brand",
		title: "Competitor Blocking",
		description: "Prevent mentions of competitor brands.",
		icon: "CurrencyDollarIcon",
		iconColor: "text-green-600",
		iconBg: "bg-green-50",
		guardrails: ["competitor-name-blocker"],
		tags: ["Brand Safety", "General"],
		complexity: "High",
		estimated_latency_ms: 3,
		parameters: [{ name: "brand_name", label: "Brand Name", type: "text", required: true }],
		llm_enrichment: { parameter: "brand_name" },
		guardrailDefinitions: [{ ...definition, guardrail_name: "competitor-name-blocker" }],
		templateData: {
			policy_name: "brand-safety",
			description: "Protect {{brand_name}}",
			guardrails_add: ["competitor-name-blocker"],
			guardrails_remove: [],
		},
	},
];
export const policyFixtureAttachment = {
	attachment_id: "fixture-attachment-12345",
	policy_name: "healthcare-compliance",
	scope: null,
	teams: ["healthcare-*", "support"],
	keys: ["prod-*"],
	models: ["gpt-4*"],
	tags: ["healthcare", "prod-*", "regulated"],
	created_at: "2026-11-06T02:00:00Z",
};
export const policyFixtureImpact = {
	affected_keys_count: 7,
	affected_teams_count: 2,
	sample_keys: ["prod-support", "prod-healthcare"],
	sample_teams: ["healthcare-east", "support"],
};
export const policyFixturePipelineResult = {
	terminal_action: "block",
	step_results: [
		{
			guardrail_name: "fixture-injection",
			outcome: "fail",
			action_taken: "block",
			modified_data: null,
			error_detail: "Prompt injection detected",
			duration_seconds: 0.012,
		},
	],
	modified_data: null,
	error_message: "Request blocked by policy",
	modify_response_message: null,
};
export function policiesFixture(url: URL, method = "GET", body: Record<string, unknown> = {}) {
	const path = url.pathname;
	if (path === "/policies/list") return { body: { policies: [policyFixtureBase, policyFixtureDraft, policyFixtureChild] } };
	if (path === "/policies/attachments/list")
		return {
			body: {
				attachments: [
					policyFixtureAttachment,
					{
						...policyFixtureAttachment,
						attachment_id: "fixture-global-12345",
						policy_name: "global-baseline",
						scope: "*",
						teams: [],
						keys: [],
						models: [],
						tags: [],
					},
				],
			},
		};
	if (path === "/policy/templates") return { body: policyFixtureTemplates };
	if (["/v2/guardrails/list", "/guardrails/list"].includes(path)) return { body: { guardrails: policyFixtureGuardrails } };
	if (path === "/guardrails" && method === "POST") return { body: body.guardrail };
	if (path === "/models") return { body: { data: [{ id: "fixture-chat" }, { id: "fixture-fast" }, { id: "gpt-4o" }] } };
	if (path === "/model_group/info") return { body: { data: [{ model_group: "fixture-chat" }, { model_group: "fixture-fast" }] } };
	if (path === "/team/list")
		return {
			body: [
				{ team_id: "fixture-team", team_alias: "healthcare-east" },
				{ team_id: "fixture-support", team_alias: "support" },
			],
		};
	if (path === "/key/list") return { body: { keys: [{ key_alias: "prod-support" }, { key_alias: "prod-healthcare" }], total_count: 2 } };
	if (path.endsWith("/resolved-guardrails"))
		return { body: { resolved_guardrails: ["fixture-injection", "fixture-pii", "fixture-topic"] } };
	if (path.endsWith("/versions"))
		return method === "POST"
			? { body: { ...policyFixtureDraft, policy_id: "fixture-base-v3", version_number: 3 } }
			: { body: { policy_name: "global-baseline", versions: [policyFixtureDraft, policyFixtureBase], total_count: 2 } };
	if (path.endsWith("/status")) return { body: { ...policyFixtureDraft, version_status: body.version_status } };
	if (path === "/policies/test-pipeline") return { body: policyFixturePipelineResult };
	if (path === "/policies/resolve")
		return {
			body: {
				effective_guardrails: ["fixture-injection", "fixture-pii"],
				matched_policies: [
					{ policy_name: "global-baseline", matched_via: "global", guardrails_added: ["fixture-injection"] },
					{ policy_name: "healthcare-compliance", matched_via: "team", guardrails_added: ["fixture-pii"] },
				],
			},
		};
	if (path === "/policies/attachments/estimate-impact")
		return { body: body.scope === "*" ? { ...policyFixtureImpact, affected_keys_count: -1 } : policyFixtureImpact };
	if (path === "/policy/templates/suggest")
		return {
			body: {
				selected_templates: [
					{ template_id: "fixture-security", reason: "Matches your prompt injection requirements." },
					{ template_id: "fixture-brand", reason: "Prevents competitor brand mentions." },
				],
				explanation: "These templates cover your security and brand safety requirements.",
			},
		};
	if (path === "/policy/templates/test")
		return {
			body: {
				results: [
					{ guardrail_name: "fixture-injection", action: "blocked", output_text: "", details: "Prompt injection detected" },
					{ guardrail_name: "fixture-pii", action: "masked", output_text: "My identifier is [REDACTED]", details: "" },
					{ guardrail_name: "fixture-topic", action: "passed", output_text: "", details: "" },
				],
				overall_action: "blocked",
			},
		};
	const enriched = {
		competitors: ["Fixture Air", "Example Airways"],
		competitor_variations: { "Fixture Air": ["FixtureAir", "Fixture Airlines"] },
		guardrailDefinitions: [{ ...definition, guardrail_name: "competitor-name-blocker" }],
	};
	if (path === "/policy/templates/enrich") return { body: enriched };
	if (path === "/policy/templates/enrich/stream")
		return {
			headers: { "Content-Type": "text/event-stream" },
			raw:
				"data: " +
				JSON.stringify({ type: "status", message: "Discovering competitors..." }) +
				"\n\ndata: " +
				JSON.stringify({ type: "competitor", name: "Fixture Air" }) +
				"\n\ndata: " +
				JSON.stringify({ type: "done", ...enriched }) +
				"\n\n",
		};
	if (path === "/policies" && method === "POST")
		return { body: { ...policyFixtureBase, ...body, policy_id: "fixture-created", version_status: "draft" } };
	if (path.startsWith("/policies/attachments/") && method === "DELETE") return { body: { status: "success" } };
	if (path === "/policies/attachments" && method === "POST") return { body: { ...policyFixtureAttachment, ...body } };
	if (path.startsWith("/policies/"))
		return {
			body:
				method === "DELETE"
					? { status: "success" }
					: path.includes("health")
						? policyFixtureChild
						: path.includes("v2")
							? { ...policyFixtureDraft, ...body }
							: { ...policyFixtureBase, ...body },
		};
	return undefined;
}
