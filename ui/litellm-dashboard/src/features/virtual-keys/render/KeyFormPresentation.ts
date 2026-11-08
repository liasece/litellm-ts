import type { KeyCatalog, KeyDraft, KeyTeam } from "../support/VirtualKeyModels";
import { selectOptions } from "../support/VirtualKeyModels";
import type { KeyField } from "../support/KeyFieldModels";

export const keyTypeOptions = [
	{ value: "default", label: "Default", description: "Can call AI APIs + Management routes" },
	{ value: "llm_api", label: "AI APIs", description: "Can call only AI API routes (chat/completions, embeddings, etc.)" },
	{ value: "management", label: "Management", description: "Can call only management routes (user/team/key management)" },
];
export const budgetDurationOptions = [
	{ value: "24h", label: "daily" },
	{ value: "7d", label: "weekly" },
	{ value: "30d", label: "monthly" },
];
const rateTypeOptions = [
	{ value: "best_effort_throughput", label: "Default", description: "Best effort throughput" },
	{ value: "guaranteed_throughput", label: "Guaranteed throughput" },
	{ value: "dynamic", label: "Dynamic" },
];
export function detailsFields(draft: KeyDraft, models: readonly string[], customKeysDisabled: boolean): KeyField[] {
	return [
		{
			name: "key_alias",
			kind: "text",
			label: ["you", "another_user"].includes(draft.owner) ? "Key Name" : "Service Account ID",
			required: true,
			help: "required",
			tremor: true,
			tooltip: ["you", "another_user"].includes(draft.owner)
				? "A descriptive name to identify this key"
				: "Unique identifier for this service account",
		},
		...(!customKeysDisabled
			? [
					{
						name: "key" as const,
						kind: "text" as const,
						label: "Custom Key",
						placeholder: "sk-...",
						help: "optional - leave blank to generate automatically",
						tremor: true,
						tooltip: "Optionally choose the Virtual Key value. Leave blank to generate one automatically.",
					},
				]
			: []),
		{
			name: "models",
			kind: "multiple",
			label: "Models",
			options: [...(!draft.project_id ? [{ value: "all-team-models", label: "All Team Models" }] : []), ...selectOptions(models)],
			disabled: ["management", "read_only"].includes(draft.key_type),
			help: ["management", "read_only"].includes(draft.key_type)
				? "Models field is disabled for this key type"
				: "optional - leave empty to allow access to all models",
			tooltip:
				"Select which models this key can access. Choose 'All Team Models' to grant access to all models available to the team. Leave empty to allow access to all models.",
		},
		{
			name: "key_type",
			kind: "select",
			label: "Key Type",
			options: keyTypeOptions,
			tooltip: "Select the type of key to determine what routes and operations this key can access",
		},
	];
}
export function budgetFields(
	team: KeyTeam | undefined,
	creating: boolean,
	formatMoney: (value: number | string | null | undefined, decimals: number) => string,
): KeyField[] {
	return [
		{
			name: "max_budget",
			kind: "number",
			label: "Max Budget (USD)",
			step: 0.01,
			precision: 2,
			width: creating ? 200 : undefined,
			tremor: true,
			help: creating ? "Budget cannot exceed team max budget: " + formatMoney(team?.max_budget ?? "unlimited", 4) : undefined,
			tooltip: creating
				? "Maximum amount in USD this key can spend. When reached, the key will be blocked from making further requests"
				: undefined,
		},
		{
			name: "budget_duration",
			kind: "select",
			label: "Reset Budget",
			options: creating
				? budgetDurationOptions
				: [
						{ value: "daily", label: "Daily" },
						{ value: "weekly", label: "Weekly" },
						{ value: "monthly", label: "Monthly" },
					],
			clearable: true,
			placeholder: "n/a",
			help: creating ? "Team Reset Budget: " + (team?.budget_duration ?? "None") : undefined,
		},
		{
			name: "tpm_limit",
			kind: "number",
			label: creating ? "Tokens per minute Limit (TPM)" : "TPM Limit",
			step: 1,
			width: creating ? 400 : undefined,
			tremor: true,
			help: creating ? "TPM cannot exceed team TPM limit: " + (team?.tpm_limit ?? "unlimited") : undefined,
		},
		{
			name: "tpm_limit_type",
			kind: "select",
			label: "TPM Rate Limit Type",
			options: rateTypeOptions,
			clearable: true,
			placeholder: "Select rate limit type",
		},
		{
			name: "rpm_limit",
			kind: "number",
			label: creating ? "Requests per minute Limit (RPM)" : "RPM Limit",
			step: 1,
			width: creating ? 400 : undefined,
			tremor: true,
			help: creating ? "RPM cannot exceed team RPM limit: " + (team?.rpm_limit ?? "unlimited") : undefined,
		},
		{
			name: "rpm_limit_type",
			kind: "select",
			label: "RPM Rate Limit Type",
			options: rateTypeOptions,
			clearable: true,
			placeholder: "Select rate limit type",
		},
	];
}
export function policyFields(catalog: KeyCatalog, canEdit: boolean, premium: boolean, editing = false): KeyField[] {
	const guardHelp = canEdit ? "Select existing guardrails or enter new ones" : "Premium feature - Upgrade to set guardrails by key";
	const policiesEnabled = premium;
	const fields: KeyField[] = [
		{
			name: "guardrails",
			kind: "multiple",
			label: "Guardrails",
			options: catalog.guardrails,
			creatable: !editing,
			disabled: !canEdit,
			help: guardHelp,
			placeholder: canEdit ? "Select or enter guardrails" : guardHelp,
			tooltip: "Apply safety guardrails to this key to filter content or enforce policies",
		},
		{
			name: "disable_global_guardrails",
			kind: "switch",
			label: "Disable Global Guardrails",
			disabled: !canEdit,
			tooltip: "When enabled, this key will bypass any guardrails configured to run on every request (global guardrails)",
			help: canEdit ? "Bypass global guardrails for this key" : "Premium feature - Upgrade to disable global guardrails by key",
		},
		{
			name: "policies",
			kind: "multiple",
			label: "Policies",
			tooltip: editing ? undefined : "Apply policies to this key to control guardrails and other settings",
			tooltipHref: editing ? undefined : "https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies",
			options: catalog.policies,
			creatable: !editing,
			disabled: !policiesEnabled,
			help: policiesEnabled ? "Select existing policies or enter new ones" : "Premium feature - Upgrade to set policies by key",
			placeholder: policiesEnabled ? "Select or enter policies" : "Premium feature - Upgrade to set policies by key",
		},
		{
			name: "prompts",
			kind: "multiple",
			label: "Prompts",
			tooltip: editing ? undefined : "Allow this key to use specific prompt templates",
			tooltipHref: editing ? undefined : "https://docs.litellm.ai/docs/proxy/prompt_management",
			options: catalog.prompts,
			creatable: true,
			disabled: !policiesEnabled,
			help: policiesEnabled ? "Select existing prompts or enter new ones" : "Premium feature - Upgrade to set prompts by key",
			placeholder: policiesEnabled ? "Select or enter prompts" : "Premium feature - Upgrade to set prompts by key",
		},
		{
			name: "access_group_ids",
			kind: "multiple",
			label: "Access Groups",
			tooltip: "Assign access groups to this key. Access groups control which models, MCP servers, and agents this key can use",
			options: catalog.accessGroups,
			placeholder: "Select access groups (optional)",
			help: "Select access groups to assign to this key",
		},
		{
			name: "allowed_passthrough_routes",
			kind: "multiple",
			creatable: true,
			label: "Allowed Pass Through Routes",
			tooltip: editing ? undefined : "Allow this key to use specific pass through routes",
			tooltipHref: editing ? undefined : "https://docs.litellm.ai/docs/proxy/pass_through",
			options: catalog.passThroughRoutes,
			disabled: !premium,
			placeholder: premium ? "Select or enter pass through routes" : "Premium feature - Upgrade to set pass through routes by key",
			help: premium
				? "Select existing pass through routes or enter new ones"
				: "Premium feature - Upgrade to set pass through routes by key",
		},
		{
			name: "vector_stores",
			kind: "multiple",
			label: editing ? "Vector Stores" : "Allowed Vector Stores",
			tooltip: editing
				? undefined
				: "Select which vector stores this key can access. If none selected, the key will have access to all available vector stores",
			options: catalog.vectorStores,
			placeholder: "Select vector stores (optional)",
			help: "Select vector stores this key can access. Leave empty for access to all vector stores",
		},
		{
			name: "metadataText",
			kind: "textarea",
			label: "Metadata",
			placeholder: "Enter metadata as JSON",
			tooltip: "JSON object with additional information about this key. Used for tracking or custom logic",
		},
		{
			name: "tags",
			kind: "multiple",
			label: "Tags",
			tooltip: editing ? undefined : "Tags for tracking spend and/or doing tag-based routing. Used for analytics and filtering",
			options: catalog.tags,
			creatable: true,
			placeholder: "Select or enter tags",
			help: "Tags for tracking spend and/or doing tag-based routing.",
		},
	];
	if (editing)
		return fields
			.filter((field) => field.name !== "metadataText")
			.map((field) => ({
				...field,
				help: undefined,
				tooltip:
					field.name === "guardrails"
						? undefined
						: field.name === "policies"
							? "Apply policies to this key to control guardrails and other settings"
							: field.name === "access_group_ids"
								? "Assign access groups to this key. Access groups control which models, MCP servers, and agents this key can use"
								: field.tooltip,
				placeholder:
					field.name === "guardrails"
						? canEdit
							? "Select guardrails"
							: "Setting guardrails is a premium feature."
						: field.name === "policies"
							? premium
								? "Select policies (production or published versions)"
								: "Setting policies is a premium feature."
							: field.name === "allowed_passthrough_routes"
								? premium
									? "Select or enter allowed pass through routes"
									: "Premium feature - Upgrade to set allowed pass through routes by key"
								: field.name === "vector_stores"
									? "Select vector stores"
									: field.placeholder,
			}))
			.sort(
				(a, b) =>
					[
						"guardrails",
						"disable_global_guardrails",
						"policies",
						"tags",
						"prompts",
						"access_group_ids",
						"allowed_passthrough_routes",
						"vector_stores",
					].indexOf(a.name) -
					[
						"guardrails",
						"disable_global_guardrails",
						"policies",
						"tags",
						"prompts",
						"access_group_ids",
						"allowed_passthrough_routes",
						"vector_stores",
					].indexOf(b.name),
			);
	return fields;
}
