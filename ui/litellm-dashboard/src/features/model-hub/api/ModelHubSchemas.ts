import { z } from "zod";
const text = z
	.string()
	.nullish()
	.transform((value) => value ?? "");
const strings = z
	.array(z.string())
	.nullish()
	.transform((value) => value ?? []);
const record = z
	.record(z.string(), z.unknown())
	.nullish()
	.transform((value) => value ?? {});
export const hubModelSchema = z
	.object({
		model_group: z.string(),
		providers: strings,
		mode: z.string().nullish(),
		max_input_tokens: z.number().nullish(),
		max_output_tokens: z.number().nullish(),
		input_cost_per_token: z.number().nullish(),
		output_cost_per_token: z.number().nullish(),
		tpm: z.number().nullish(),
		rpm: z.number().nullish(),
		is_public_model_group: z.boolean().optional(),
		supported_openai_params: z.array(z.string()).optional(),
		health_status: z.string().nullish(),
		health_response_time: z.number().nullish(),
		health_checked_at: z.string().nullish(),
	})
	.passthrough();
export const hubAgentSchema = z
	.object({
		agent_id: z.string().optional(),
		name: z.string(),
		description: text,
		url: text,
		version: text,
		protocolVersion: text,
		capabilities: record,
		defaultInputModes: strings,
		defaultOutputModes: strings,
		skills: z
			.array(
				z.object({ id: z.string(), name: z.string(), description: text, tags: strings, examples: z.array(z.string()).optional() }),
			)
			.nullish()
			.transform((value) => value ?? []),
		supportsAuthenticatedExtendedCard: z.boolean().optional(),
		is_public: z.boolean().optional(),
		iconUrl: z.string().optional(),
		documentationUrl: z.string().optional(),
		provider: z.object({ organization: z.string(), url: text }).optional(),
	})
	.passthrough();
export const hubMcpSchema = z
	.object({
		server_id: z.string(),
		server_name: text,
		name: z.string().optional(),
		alias: z.string().nullish(),
		description: z.string().nullish(),
		url: text,
		transport: text,
		auth_type: text,
		status: text,
		created_at: text,
		created_by: text,
		updated_at: text,
		updated_by: text,
		allowed_tools: strings,
		teams: strings,
		mcp_access_groups: strings,
		mcp_info: record,
		command: z.string().nullish(),
		last_health_check: z.string().nullish(),
		health_check_error: z.string().nullish(),
	})
	.passthrough();
export const hubInfoSchema = z.object({
	custom_docs_description: z
		.string()
		.nullish()
		.transform((value) => value ?? null),
	litellm_version: text,
	useful_links: z
		.record(z.string(), z.union([z.string(), z.object({ url: z.string(), index: z.number().optional() })]))
		.nullish()
		.transform((value) => value ?? {}),
});
export const hubMarketplaceSchema = z.object({
	name: text,
	owner: z.object({ name: text, email: z.string().optional() }),
	plugins: z.array(
		z
			.object({
				name: z.string(),
				source: z.object({ source: z.enum(["github", "url"]), repo: z.string().optional(), url: z.string().optional() }),
				version: z.string().optional(),
				description: z.string().optional(),
				keywords: z.array(z.string()).optional(),
				category: z.string().optional(),
			})
			.passthrough(),
	),
});
