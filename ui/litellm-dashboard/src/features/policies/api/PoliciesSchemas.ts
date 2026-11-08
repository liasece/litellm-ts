import { z } from "zod";
const textList = z.array(z.string()),
	record = z.record(z.string(), z.unknown());
export const pipelineActionSchema = z.enum(["next", "allow", "block", "modify_response"]);
export const pipelineSchema = z.object({
	mode: z.enum(["pre_call", "post_call"]),
	steps: z.array(
		z.object({
			guardrail: z.string(),
			on_pass: pipelineActionSchema,
			on_fail: pipelineActionSchema,
			pass_data: z.boolean().optional(),
			modify_response_message: z.string().nullish(),
		}),
	),
});
export const policySchema = z
	.object({
		policy_id: z.string(),
		policy_name: z.string(),
		inherit: z
			.string()
			.nullish()
			.transform((v) => v ?? null),
		description: z
			.string()
			.nullish()
			.transform((v) => v ?? null),
		guardrails_add: textList.nullish().transform((v) => v ?? []),
		guardrails_remove: textList.nullish().transform((v) => v ?? []),
		condition: z
			.object({ model: z.union([z.string(), textList]).optional() })
			.nullish()
			.transform((v) => v ?? null),
		pipeline: pipelineSchema.nullish(),
		version_number: z.number().optional(),
		version_status: z.enum(["draft", "published", "production"]).optional(),
		parent_version_id: z.string().nullish(),
		created_at: z.string().optional(),
		updated_at: z.string().optional(),
		created_by: z.string().optional(),
		updated_by: z.string().optional(),
	})
	.passthrough();
export const attachmentSchema = z
	.object({
		attachment_id: z.string(),
		policy_name: z.string(),
		scope: z
			.string()
			.nullish()
			.transform((v) => v ?? null),
		teams: textList.nullish().transform((v) => v ?? []),
		keys: textList.nullish().transform((v) => v ?? []),
		models: textList.nullish().transform((v) => v ?? []),
		tags: textList.nullish().transform((v) => v ?? []),
		created_at: z.string().optional(),
		updated_at: z.string().optional(),
		metadata: record.nullish(),
	})
	.passthrough();
export const impactSchema = z.object({
	affected_keys_count: z.number(),
	affected_teams_count: z.number(),
	sample_keys: textList,
	sample_teams: textList,
});
export const resolutionSchema = z.object({
	effective_guardrails: textList,
	matched_policies: z.array(z.object({ policy_name: z.string(), matched_via: z.string(), guardrails_added: textList })),
});
export const pipelineTestSchema = z.object({
	terminal_action: z.string(),
	step_results: z.array(
		z.object({
			guardrail_name: z.string(),
			outcome: z.enum(["pass", "fail", "error"]),
			action_taken: z.string(),
			modified_data: record.nullish().transform((v) => v ?? null),
			error_detail: z
				.string()
				.nullish()
				.transform((v) => v ?? null),
			duration_seconds: z
				.number()
				.nullish()
				.transform((v) => v ?? null),
		}),
	),
	modified_data: record.nullish(),
	error_message: z.string().nullish(),
	modify_response_message: z.string().nullish(),
});
export const definitionSchema = z
	.object({
		guardrail_name: z.string(),
		litellm_params: z
			.object({
				guardrail: z.string().optional(),
				mode: z.union([z.string(), textList]).optional(),
				patterns: z.array(z.unknown()).optional(),
				categories: z.array(z.unknown()).optional(),
			})
			.passthrough()
			.optional(),
		guardrail_info: z.object({ description: z.string().optional() }).passthrough().nullish(),
	})
	.passthrough();
export const templateSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		description: z.string(),
		icon: z.string().optional(),
		iconColor: z.string().optional(),
		iconBg: z.string().optional(),
		guardrails: textList.default([]),
		tags: textList.default([]),
		inherits: z.string().optional(),
		complexity: z.enum(["Low", "Medium", "High"]),
		estimated_latency_ms: z.number().optional(),
		parameters: z
			.array(
				z.object({
					name: z.string(),
					label: z.string(),
					type: z.string(),
					required: z.boolean(),
					placeholder: z.string().optional(),
				}),
			)
			.default([]),
		llm_enrichment: z.object({ parameter: z.string() }).passthrough().optional(),
		guardrailDefinitions: z.array(definitionSchema).default([]),
		templateData: z
			.object({
				policy_name: z.string().optional(),
				description: z.string().nullish(),
				inherit: z.string().nullish(),
				guardrails_add: textList.optional(),
				guardrails_remove: textList.optional(),
				condition: z.object({ model: z.union([z.string(), textList]).optional() }).nullish(),
				pipeline: pipelineSchema.nullish(),
			})
			.passthrough(),
		discoveredCompetitors: textList.optional(),
	})
	.passthrough();
export const enrichmentSchema = z.object({
	competitors: textList.default([]),
	competitor_variations: z.record(z.string(), textList).default({}),
	guardrailDefinitions: z.array(definitionSchema).default([]),
});
export const suggestionSchema = z.object({
	selected_templates: z.array(z.object({ template_id: z.string(), reason: z.string(), template: templateSchema.optional() })).default([]),
	explanation: z.string().nullish(),
});
export const templateTestSchema = z.object({
	results: z
		.array(
			z.object({
				guardrail_name: z.string(),
				action: z.string(),
				output_text: z.string().default(""),
				details: z.string().default(""),
			}),
		)
		.default([]),
	overall_action: z.string().default("passed"),
});
