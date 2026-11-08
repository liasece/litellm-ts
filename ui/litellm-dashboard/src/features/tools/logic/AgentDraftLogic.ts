import { AGENT_FORM_CONFIG } from "../support/AgentFieldSupport";
import type { Agent, AgentTypeInfo, AgentFlowOptions, AgentEntitlements, AgentSkill } from "../support/AgentModels";
export const rateLimitFields = ["tpm_limit", "rpm_limit", "session_tpm_limit", "session_rpm_limit"] as const;
export const agentCostFields = ["cost_per_query", "input_cost_per_token", "output_cost_per_token"] as const;
export function defaultAgentDraft(): Record<string, unknown> {
	const defaults: Record<string, unknown> = { defaultInputModes: ["text"], defaultOutputModes: ["text"] };
	for (const section of Object.values(AGENT_FORM_CONFIG))
		for (const field of section.fields)
			if (field.defaultValue !== undefined) defaults[field.name] = structuredClone(field.defaultValue);
	return defaults;
}
export function baseAgentPayload(values: Record<string, unknown>, existing?: Agent): Record<string, unknown> {
	const card = {
		protocolVersion: values.protocolVersion || "1.0",
		name: values.name || values.agent_name,
		description: values.description || "",
		url: values.url || "",
		version: values.version || "1.0.0",
		defaultInputModes: existing?.agent_card_params?.defaultInputModes || ["text"],
		defaultOutputModes: existing?.agent_card_params?.defaultOutputModes || ["text"],
		capabilities: {
			streaming: values.streaming === true,
			...(values.pushNotifications !== undefined ? { pushNotifications: values.pushNotifications } : {}),
			...(values.stateTransitionHistory !== undefined ? { stateTransitionHistory: values.stateTransitionHistory } : {}),
		},
		skills: values.skills || [],
		...(values.iconUrl ? { iconUrl: values.iconUrl } : {}),
		...(values.documentationUrl ? { documentationUrl: values.documentationUrl } : {}),
		...(values.supportsAuthenticatedExtendedCard !== undefined
			? { supportsAuthenticatedExtendedCard: values.supportsAuthenticatedExtendedCard }
			: {}),
	};
	const result: Record<string, unknown> = { agent_name: values.agent_name, agent_card_params: card },
		params: Record<string, unknown> = {};
	if (values.model) params.model = values.model;
	if (values.make_public !== undefined) params.make_public = values.make_public;
	for (const key of agentCostFields) if (values[key]) params[key] = parseFloat(String(values[key]));
	if (Object.keys(params).length) result.litellm_params = params;
	for (const key of rateLimitFields) if (values[key] != null) result[key] = values[key];
	if (Array.isArray(values.static_headers) && values.static_headers.length) {
		const headers: Record<string, string> = {};
		for (const value of values.static_headers) {
			if (value && typeof value === "object") {
				const item = value as Record<string, unknown>,
					key = String(item.header || "").trim();
				if (key) headers[key] = String(item.value ?? "");
			}
		}
		if (Object.keys(headers).length) result.static_headers = headers;
	}
	if (Array.isArray(values.extra_headers) && values.extra_headers.length) result.extra_headers = values.extra_headers;
	return result;
}
export function dynamicAgentPayload(values: Record<string, unknown>, info: AgentTypeInfo): Record<string, unknown> {
	const params: Record<string, unknown> = { ...info.litellm_params_template };
	for (const field of info.credential_fields)
		if (values[field.key] && field.include_in_litellm_params !== false) params[field.key] = values[field.key];
	for (const key of agentCostFields) if (values[key]) params[key] = parseFloat(String(values[key]));
	if (info.model_template) {
		let model = info.model_template;
		for (const field of info.credential_fields)
			if (values[field.key]) model = model.replace("{" + field.key + "}", String(values[field.key]));
		params.model = model;
	}
	const result: Record<string, unknown> = {
		agent_name: values.agent_name,
		agent_card_params: {
			protocolVersion: "1.0",
			name: values.display_name || values.agent_name,
			description: values.description || info.agent_type_display_name + " agent",
			url: values.api_base || "",
			version: "1.0.0",
			defaultInputModes: ["text"],
			defaultOutputModes: ["text"],
			capabilities: { streaming: true },
			skills: [{ id: "chat", name: "Chat", description: "General chat capability", tags: ["chat", "conversation"] }],
		},
		litellm_params: params,
	};
	for (const key of rateLimitFields) if (values[key] != null) result[key] = values[key];
	return result;
}
export function createAgentPayload(
	values: Record<string, unknown>,
	options: AgentFlowOptions,
	info: AgentTypeInfo | undefined,
	entitlements: AgentEntitlements,
): Record<string, unknown> | null {
	let result: Record<string, unknown>;
	if (options.type === "custom")
		result = {
			agent_name: values.agent_name,
			agent_card_params: {
				protocolVersion: "1.0",
				name: values.agent_name,
				description: values.description || "",
				url: "",
				version: "1.0.0",
				defaultInputModes: ["text"],
				defaultOutputModes: ["text"],
				capabilities: { streaming: false },
				skills: [],
			},
		};
	else if (options.type === "a2a") result = baseAgentPayload(values);
	else if (info?.use_a2a_form_fields) {
		result = baseAgentPayload(values);
		const params = { ...(result.litellm_params as Record<string, unknown> | undefined), ...info.litellm_params_template };
		for (const field of info.credential_fields)
			if (values[field.key] && field.include_in_litellm_params !== false) params[field.key] = String(values[field.key]);
		result.litellm_params = params;
	} else if (info) result = dynamicAgentPayload(values, info);
	else return null;
	const permission: Record<string, unknown> = {};
	for (const key of ["mcp_servers", "mcp_access_groups", "models", "agents"] as const)
		if (entitlements[key].length) permission[key] = entitlements[key];
	if (Object.keys(entitlements.mcp_tool_permissions).length) permission.mcp_tool_permissions = entitlements.mcp_tool_permissions;
	if (Object.keys(permission).length) result.object_permission = permission;
	const params = { ...(result.litellm_params as Record<string, unknown> | undefined) };
	if (options.requireInbound) params.require_trace_id_on_calls_to_agent = true;
	if (options.requireOutbound) {
		params.require_trace_id_on_calls_by_agent = true;
		if (options.maxIterations) params.max_iterations = options.maxIterations;
		if (options.maxBudget) params.max_budget_per_session = options.maxBudget;
	}
	if (Array.isArray(values.guardrails) && values.guardrails.length) params.guardrails = values.guardrails;
	if (Object.keys(params).length) result.litellm_params = params;
	if (values.team_id) result.team_id = values.team_id;
	return result;
}
export function detectAgentType(agent: Agent) {
	const provider = agent.litellm_params.custom_llm_provider,
		model = agent.litellm_params.model || "";
	if (provider === "langgraph") return "langgraph";
	if (provider === "azure_ai") return "azure_ai_foundry";
	if (provider === "bedrock") return "bedrock_agentcore";
	if (model.startsWith("langgraph/")) return "langgraph";
	if (model.startsWith("azure_ai/agents/")) return "azure_ai_foundry";
	if (model.startsWith("bedrock/agentcore/")) return "bedrock_agentcore";
	return "a2a";
}
export function parseAgentDraft(agent: Agent, info?: AgentTypeInfo): Record<string, unknown> {
	if (info && detectAgentType(agent) !== "a2a") {
		const result: Record<string, unknown> = { agent_name: agent.agent_name, description: agent.agent_card_params?.description || "" };
		for (const field of info.credential_fields)
			if (field.include_in_litellm_params !== false) result[field.key] = agent.litellm_params[field.key] || field.default_value || "";
			else if (info.model_template && agent.litellm_params.model) {
				info.model_template.split("/").forEach((part, index) => {
					if (part === "{" + field.key + "}" && agent.litellm_params.model?.split("/")[index])
						result[field.key] = agent.litellm_params.model.split("/")[index];
				});
			}
		for (const key of agentCostFields) result[key] = agent.litellm_params[key];
		return result;
	}
	const card = agent.agent_card_params || {},
		result: Record<string, unknown> = {
			agent_name: agent.agent_name,
			...card,
			...card.capabilities,
			skills: (card.skills || []).map((skill: AgentSkill) => ({ ...skill, examples: skill.examples || [] })),
			model: agent.litellm_params.model,
			make_public: agent.litellm_params.make_public,
			static_headers: Object.entries(agent.static_headers || {}).map(([header, value]) => ({ header, value })),
			extra_headers: agent.extra_headers || [],
		};
	for (const key of [...rateLimitFields, ...agentCostFields]) result[key] = key in agent ? agent[key] : agent.litellm_params[key];
	return result;
}
