export interface CsvUserRow extends Record<string, unknown> {
	user_email: string;
	user_role: string;
	teams?: string;
	models?: string;
	metadata?: string;
	max_budget?: string;
	budget_duration?: string;
	rowNumber: number;
	isValid: boolean;
	error: string;
	status?: "pending" | "success" | "failed";
	key?: string;
	invitation_link?: string;
}
