import type { KeyDraft, KeyTeam } from "../support/VirtualKeyModels";
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
			options: [{ value: "all-team-models", label: "All Team Models" }, ...selectOptions(models)],
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
