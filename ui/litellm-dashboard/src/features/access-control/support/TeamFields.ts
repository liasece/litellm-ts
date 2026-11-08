export interface AccessFieldDefinition {
	name: string;
	label: string;
	type?: "text" | "number" | "select" | "textarea" | "switch";
	help?: string;
	placeholder?: string;
	required?: boolean;
	rows?: number;
	step?: number;
	premium?: boolean;
}
export const teamGeneralFields: AccessFieldDefinition[] = [
	{ name: "team_alias", label: "Team Name", required: true },
	{ name: "models", label: "Models", type: "select", required: true },
	{ name: "max_budget", label: "Max Budget (USD)", type: "number", step: 0.01 },
	{ name: "team_member_budget", label: "Team Member Budget (USD)", type: "number", step: 0.01 },
	{ name: "team_member_key_duration", label: "Team Member Key Duration (eg: 1d, 1mo)", placeholder: "e.g., 30d" },
	{ name: "team_member_tpm_limit", label: "Team Member TPM Limit", type: "number", placeholder: "e.g., 1000" },
	{ name: "team_member_rpm_limit", label: "Team Member RPM Limit", type: "number", placeholder: "e.g., 100" },
	{ name: "budget_duration", label: "Reset Budget", type: "select", placeholder: "n/a" },
	{ name: "tpm_limit", label: "Tokens per minute Limit (TPM)", type: "number" },
	{ name: "rpm_limit", label: "Requests per minute Limit (RPM)", type: "number" },
];
export const teamEditExtraFields: AccessFieldDefinition[] = [
	{ name: "soft_budget", label: "Soft Budget (USD)", type: "number", step: 0.01 },
	{ name: "soft_budget_alerting_emails", label: "Soft Budget Alerting Emails", placeholder: "example1@test.com, example2@test.com" },
	{ name: "team_member_budget_duration", label: "Team Member Budget Duration", type: "select" },
];
export const organizationFields: AccessFieldDefinition[] = [
	{ name: "organization_alias", label: "Organization Name", required: true },
	{ name: "models", label: "Models", type: "select" },
	{ name: "max_budget", label: "Max Budget (USD)", type: "number", step: 0.01 },
	{ name: "budget_duration", label: "Reset Budget", type: "select", placeholder: "n/a" },
	{ name: "tpm_limit", label: "Tokens per minute Limit (TPM)", type: "number" },
	{ name: "rpm_limit", label: "Requests per minute Limit (RPM)", type: "number" },
];
export const budgetDurationOptions = [
	{ value: "24h", label: "daily" },
	{ value: "7d", label: "weekly" },
	{ value: "30d", label: "monthly" },
];
