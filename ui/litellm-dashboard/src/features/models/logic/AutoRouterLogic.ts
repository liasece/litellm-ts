import { modelRecord, modelString, modelStrings, type ModelDeploymentRequest } from "../support/ModelModels";
export interface SemanticRoute {
	id: string;
	name: string;
	description: string;
	utterances: string[];
	score_threshold: number;
}
export const complexityDescriptions = {
	SIMPLE: {
		label: "Simple",
		description: "Basic questions, greetings, simple factual queries",
		examples: '"Hello!", "What is Python?", "Thanks!"',
	},
	MEDIUM: {
		label: "Medium",
		description: "Standard queries requiring some reasoning or explanation",
		examples: '"Explain how REST APIs work", "Debug this error"',
	},
	COMPLEX: {
		label: "Complex",
		description: "Technical, multi-part requests requiring deep knowledge",
		examples: '"Design a microservices architecture", "Implement a rate limiter"',
	},
	REASONING: {
		label: "Reasoning",
		description: "Chain-of-thought, analysis, explicit reasoning requests",
		examples: '"Think step by step...", "Analyze the pros and cons..."',
	},
};
export type ComplexityTiers = Record<keyof typeof complexityDescriptions, string>;
export function createAutoRouter(
	values: Record<string, unknown>,
	type: "complexity" | "semantic",
	tiers: ComplexityTiers,
	routes: SemanticRoute[],
): ModelDeploymentRequest {
	const name = modelString(values.auto_router_name);
	if (!name) throw new Error("Please enter an Auto Router Name");
	const info: Record<string, unknown> = {};
	if (values.team_id) info.team_id = values.team_id;
	const access = modelStrings(values.model_access_group);
	if (access.length) info.access_groups = access;
	if (type === "complexity") {
		const defaultModel = tiers.MEDIUM || tiers.SIMPLE || tiers.COMPLEX || tiers.REASONING;
		if (!defaultModel) throw new Error("Please select at least one model for a complexity tier");
		return {
			model_name: name,
			litellm_params: {
				model: "auto_router/complexity_router",
				complexity_router_config: { tiers: { ...tiers } },
				complexity_router_default_model: defaultModel,
			},
			model_info: info,
		};
	}
	if (!values.auto_router_default_model) throw new Error("Please select a Default Model");
	if (!routes.length) throw new Error("Please configure at least one route for the auto router");
	if (routes.some((route) => !route.name || !route.description || !route.utterances.length))
		throw new Error("Please ensure all routes have a target model, description, and at least one utterance");
	const config = {
		routes: routes.map(({ name, description, utterances, score_threshold }) => ({ name, utterances, description, score_threshold })),
	};
	const params: Record<string, unknown> = {
		model: "auto_router/" + name,
		auto_router_config: JSON.stringify(config),
		auto_router_default_model: values.auto_router_default_model,
	};
	if (values.auto_router_embedding_model && values.auto_router_embedding_model !== "custom")
		params.auto_router_embedding_model = values.auto_router_embedding_model;
	else if (values.custom_embedding_model) params.auto_router_embedding_model = values.custom_embedding_model;
	return { model_name: name, litellm_params: params, model_info: info };
}
export function routesFromConfig(value: unknown): SemanticRoute[] {
	const routes = modelRecord(value).routes;
	return Array.isArray(routes)
		? routes.map((item, index) => {
				const route = modelRecord(item);
				return {
					id: modelString(route.id) || "route-" + index,
					name: modelString(route.name) || modelString(route.model),
					description: modelString(route.description),
					utterances: modelStrings(route.utterances),
					score_threshold: Number(route.score_threshold ?? 0.5),
				};
			})
		: [];
}
