export interface ToolTag extends Record<string, unknown> {
	name: string;
	description?: string | null;
	models: string[];
	model_info?: Record<string, string>;
	created_at: string;
	updated_at: string;
	created_by?: string;
	updated_by?: string;
	litellm_budget_table?: {
		max_budget?: number | null;
		soft_budget?: number | null;
		tpm_limit?: number | null;
		rpm_limit?: number | null;
		budget_duration?: string | null;
	};
}
export interface TagModelOption {
	value: string;
	label: string;
}
export const dynamicSpendTagDescription =
	"This is just a spend tag that was passed dynamically in a request. It does not control any LLM models.";
