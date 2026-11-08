import type {
	Policy,
	PolicyWrite,
	PolicySimpleForm,
	AttachmentForm,
	AttachmentWrite,
	PolicyTemplate,
	GuardrailPipeline,
	PipelineStep,
} from "../support/PolicyModels";
export function groupPolicies(policies: Policy[]) {
	const groups = new Map<string, Policy[]>();
	for (const policy of policies) {
		const name = policy.policy_name || "(unnamed)";
		groups.set(name, [...(groups.get(name) ?? []), policy]);
	}
	return Array.from(groups, ([name, versions]) => ({
		name,
		policy:
			versions.find((v) => v.version_status === "production") ??
			[...versions].sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))[0]!,
		versionCount: versions.length,
	})).sort((a, b) => a.name.localeCompare(b.name));
}
export function resolvedGuardrails(policies: Policy[], inherit: string, add: string[], remove: string[]): string[] {
	const resolve = (name: string, seen: Set<string>): Set<string> => {
		if (seen.has(name)) return new Set();
		seen.add(name);
		const p = policies.find((v) => v.policy_name === name);
		if (!p) return new Set();
		const result = p.inherit ? resolve(p.inherit, seen) : new Set<string>();
		p.guardrails_add.forEach((g) => result.add(g));
		p.guardrails_remove.forEach((g) => result.delete(g));
		return result;
	};
	const result = resolve(inherit, new Set());
	add.forEach((g) => result.add(g));
	remove.forEach((g) => result.delete(g));
	return [...result].sort();
}
export function simplePolicyData(form: PolicySimpleForm): PolicyWrite {
	return {
		policy_name: form.policy_name,
		description: form.description || undefined,
		inherit: form.inherit || undefined,
		guardrails_add: form.guardrails_add,
		guardrails_remove: form.guardrails_remove,
		condition: form.model_condition ? { model: form.model_condition } : undefined,
	};
}
export function attachmentData(form: Omit<AttachmentForm, "policy_names">, policy: string, scope: "global" | "specific"): AttachmentWrite {
	if (scope === "global") return { policy_name: policy, scope: "*" };
	const result: AttachmentWrite = { policy_name: policy };
	for (const key of ["teams", "keys", "models", "tags"] as const) if (form[key].length) result[key] = form[key];
	return result;
}
export const createPipelineStep = (): PipelineStep => ({
	guardrail: "",
	on_pass: "next",
	on_fail: "block",
	pass_data: false,
	modify_response_message: null,
});
export function derivePipeline(policy?: Partial<Policy> | null): GuardrailPipeline {
	if (policy?.pipeline?.steps.length) return { mode: policy.pipeline.mode, steps: policy.pipeline.steps.map((step) => ({ ...step })) };
	return {
		mode: policy?.pipeline?.mode ?? "pre_call",
		steps: policy?.guardrails_add?.length
			? policy.guardrails_add.map((guardrail) => ({ ...createPipelineStep(), guardrail }))
			: [createPipelineStep()],
	};
}
export function normalizeCompetitors(names: readonly string[]): string[] {
	const seen = new Set<string>();
	return names
		.map((n) => n.trim())
		.filter((n) => {
			const key = n.toLowerCase();
			if (!n || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}
export function substituteTemplate(template: PolicyTemplate, values: Record<string, string>): PolicyTemplate {
	let text = JSON.stringify(template);
	for (const [key, value] of Object.entries(values)) text = text.split("{{" + key + "}}").join(value);
	return JSON.parse(text) as PolicyTemplate;
}
export function templateTagCounts(templates: PolicyTemplate[]): [string, number][] {
	const counts = new Map<string, number>();
	templates.forEach((t) => t.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
	return [...counts].sort(([a], [b]) => a.localeCompare(b));
}
export function templateHasTags(template: PolicyTemplate, tags: Set<string>) {
	return [...tags].every((tag) => template.tags.includes(tag));
}
export const policyDate = (date?: string) => (date ? new Date(date).toLocaleString() : "-");
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
