import type { AccessProject, AccessRecord, ProjectDraft } from "../support/AccessModels";
export function createProjectDraft(project?: AccessProject): ProjectDraft {
	const metadata = project?.metadata ?? {};
	const rpm = (metadata.model_rpm_limit ?? {}) as Record<string, number>;
	const tpm = (metadata.model_tpm_limit ?? {}) as Record<string, number>;
	return {
		project_alias: project?.project_alias ?? "",
		team_id: project?.team_id ?? "",
		description: project?.description ?? "",
		models: [...(project?.models ?? [])],
		max_budget: project?.litellm_budget_table?.max_budget == null ? undefined : Number(project.litellm_budget_table.max_budget),
		isBlocked: project?.blocked ?? false,
		modelLimits: [...new Set([...Object.keys(rpm), ...Object.keys(tpm)])].map((model) => ({
			model,
			rpm: rpm[model] ?? null,
			tpm: tpm[model] ?? null,
		})),
		metadata: Object.entries(metadata)
			.filter(([key]) => !["model_rpm_limit", "model_tpm_limit"].includes(key))
			.map(([key, value]) => ({ key, value: String(value) })),
	};
}
export function validateProjectDraft(value: ProjectDraft): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!value.project_alias) errors.project_alias = "Please enter a project name";
	if (!value.team_id) errors.team_id = "Please select a team";
	for (const [field, entries] of [
		["modelLimits", value.modelLimits.map((row) => row.model)],
		["metadata", value.metadata.map((row) => row.key)],
	] as const) {
		if (entries.some((entry) => !entry)) errors[field] = field === "modelLimits" ? "Missing model" : "Missing key";
		else if (new Set(entries).size !== entries.length) errors[field] = field === "modelLimits" ? "Duplicate model" : "Duplicate key";
	}
	if (value.metadata.some((row) => !row.value)) errors.metadata = "Missing value";
	return errors;
}
export function buildProjectPayload(values: ProjectDraft): AccessRecord {
	const rpm: Record<string, number> = {},
		tpm: Record<string, number> = {},
		metadata: AccessRecord = {};
	for (const entry of values.modelLimits)
		if (entry.model) {
			if (entry.rpm != null) rpm[entry.model] = entry.rpm;
			if (entry.tpm != null) tpm[entry.model] = entry.tpm;
		}
	for (const entry of values.metadata) if (entry.key) metadata[entry.key] = entry.value;
	return {
		project_alias: values.project_alias,
		description: values.description,
		team_id: values.team_id,
		models: values.models ?? [],
		...(values.max_budget !== undefined ? { max_budget: values.max_budget } : {}),
		blocked: values.isBlocked,
		...(Object.keys(rpm).length ? { model_rpm_limit: rpm } : {}),
		...(Object.keys(tpm).length ? { model_tpm_limit: tpm } : {}),
		...(Object.keys(metadata).length ? { metadata } : {}),
	};
}
