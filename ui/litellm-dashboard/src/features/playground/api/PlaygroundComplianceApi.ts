import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const result = z
		.object({
			guardrail_errors: z
				.array(z.object({ guardrail_name: z.string().nullish(), message: z.string().nullish() }).passthrough())
				.optional(),
			inputs: z
				.object({ texts: z.array(z.unknown()).optional() })
				.passthrough()
				.nullish(),
			agent_response: z.unknown().optional(),
		})
		.passthrough(),
	response = result.extend({ results: z.array(result).optional() });
export async function testCompliance(
	body: {
		policy_names?: string[];
		guardrail_names?: string[];
		inputs?: { texts: string[] };
		inputs_list?: { texts: string[] }[];
		agent_id?: string;
	},
	signal?: AbortSignal,
) {
	return requestJson(
		"/utils/test_policies_and_guardrails",
		{
			method: "POST",
			signal,
			body: JSON.stringify({
				policy_names: body.policy_names ?? null,
				guardrail_names: body.guardrail_names ?? null,
				inputs: body.inputs ?? null,
				inputs_list: body.inputs_list ?? null,
				request_data: {},
				input_type: "request",
				agent_id: body.agent_id ?? null,
			}),
		},
		(value) => response.parse(value),
	);
}
