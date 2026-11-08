import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import {
	policySchema,
	attachmentSchema,
	impactSchema,
	resolutionSchema,
	pipelineTestSchema,
	templateSchema,
	enrichmentSchema,
	suggestionSchema,
	templateTestSchema,
} from "./PoliciesSchemas";
import type {
	PolicyWrite,
	AttachmentWrite,
	PolicyContext,
	GuardrailPipeline,
	GuardrailDefinition,
	PolicyVersionStatus,
} from "../support/PolicyModels";
const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });
const part = encodeURIComponent;
const rows = z.array(z.record(z.string(), z.unknown()));
function aliases(value: unknown, key: string, field: string): string[] {
	const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return rows
		.parse(Array.isArray(value) ? value : (record[key] ?? record.data ?? []))
		.map((v) => v[field])
		.filter((v): v is string => typeof v === "string" && !!v);
}
export const policiesApi = {
	list: (signal?: AbortSignal) =>
		requestJson("/policies/list", { signal }, (v) => z.object({ policies: z.array(policySchema) }).parse(v).policies),
	detail: (id: string, signal?: AbortSignal) => requestJson("/policies/" + part(id), { signal }, (v) => policySchema.parse(v)),
	create: (body: PolicyWrite) => requestJson("/policies", json(body)),
	update: (id: string, body: PolicyWrite) => requestJson("/policies/" + part(id), json(body, "PUT")),
	delete: (id: string) => requestJson("/policies/" + part(id), { method: "DELETE" }),
	resolved: (id: string, signal?: AbortSignal) =>
		requestJson(
			"/policies/" + part(id) + "/resolved-guardrails",
			{ signal },
			(v) => z.object({ resolved_guardrails: z.array(z.string()) }).parse(v).resolved_guardrails,
		),
	versions: (name: string, signal?: AbortSignal) =>
		requestJson(
			"/policies/name/" + part(name) + "/versions",
			{ signal },
			(v) => z.object({ versions: z.array(policySchema) }).parse(v).versions,
		),
	createVersion: (name: string, sourcePolicyId?: string | null) =>
		requestJson("/policies/name/" + part(name) + "/versions", json({ source_policy_id: sourcePolicyId ?? undefined }), (v) =>
			policySchema.parse(v),
		),
	setStatus: (id: string, status: Exclude<PolicyVersionStatus, "draft">) =>
		requestJson("/policies/" + part(id) + "/status", json({ version_status: status }, "PUT"), (v) => policySchema.parse(v)),
	attachments: (signal?: AbortSignal) =>
		requestJson(
			"/policies/attachments/list",
			{ signal },
			(v) => z.object({ attachments: z.array(attachmentSchema) }).parse(v).attachments,
		),
	createAttachment: (body: AttachmentWrite) => requestJson("/policies/attachments", json(body)),
	deleteAttachment: (id: string) => requestJson("/policies/attachments/" + part(id), { method: "DELETE" }),
	impact: (body: AttachmentWrite) => requestJson("/policies/attachments/estimate-impact", json(body), (v) => impactSchema.parse(v)),
	resolve: (context: PolicyContext) => requestJson("/policies/resolve", json(context), (v) => resolutionSchema.parse(v)),
	testPipeline: (pipeline: GuardrailPipeline, testMessages: { role: string; content: string }[]) =>
		requestJson("/policies/test-pipeline", json({ pipeline, test_messages: testMessages }), (v) => pipelineTestSchema.parse(v)),
	templates: (signal?: AbortSignal) => requestJson("/policy/templates", { signal }, (v) => z.array(templateSchema).parse(v)),
	enrich: (id: string, parameters: Record<string, string>, model?: string, competitors?: string[]) =>
		requestJson("/policy/templates/enrich", json({ template_id: id, parameters, model, competitors }), (v) =>
			enrichmentSchema.parse(v),
		),
	suggest: (examples: string[], description: string, model: string) =>
		requestJson("/policy/templates/suggest", json({ attack_examples: examples.filter((v) => v.trim()), description, model }), (v) =>
			suggestionSchema.parse(v),
		),
	testTemplate: (definitions: GuardrailDefinition[], text: string) =>
		requestJson("/policy/templates/test", json({ guardrail_definitions: definitions, text }), (v) => templateTestSchema.parse(v)),
	teams: (userId?: string) =>
		requestJson("/team/list" + (userId ? "?user_id=" + part(userId) : ""), {}, (v) => aliases(v, "data", "team_alias")),
	keys: () => requestJson("/key/list?page=1&size=100", {}, (v) => aliases(v, "keys", "key_alias")),
	models: () =>
		requestJson("/models?include_model_access_groups=True", {}, (v) => {
			const record = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
			return rows
				.parse(Array.isArray(v) ? v : (record.data ?? []))
				.map((m) => m.id || m.model_name)
				.filter((m): m is string => typeof m === "string" && !!m);
		}),
	hubModels: () => requestJson("/model_group/info", {}, (v) => aliases(v, "data", "model_group").sort()),
};
export type PoliciesApi = typeof policiesApi;
