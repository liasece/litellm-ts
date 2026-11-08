export interface GuardrailPerformanceRow extends Record<string, unknown> {
	id: string;
	name: string;
	type: string;
	provider: string;
	requestsEvaluated: number;
	failRate: number;
	avgScore?: number | null;
	avgLatency?: number | null;
	p95Latency?: number | null;
	falsePositiveRate?: number | null;
	falseNegativeRate?: number | null;
	status: string;
	trend: string;
}
export interface GuardrailsUsageOverview {
	rows: GuardrailPerformanceRow[];
	totalRequests?: number;
	totalBlocked?: number;
	passRate?: number | string;
	chart?: { date: string; passed: number; blocked: number }[];
}
export interface GuardrailsUsageDetail extends Record<string, unknown> {
	guardrail_name: string;
	description?: string | null;
	status: string;
	provider: string;
	type: string;
	requestsEvaluated: number;
	failRate: number;
	avgScore?: number | null;
	avgLatency?: number | null;
}
export interface GuardrailsMonitorLog extends Record<string, unknown> {
	id: string;
	timestamp: string;
	action: "blocked" | "passed" | "flagged";
	input?: string;
	output?: string;
	input_snippet?: string;
	output_snippet?: string;
	score?: number;
	model?: string;
	reason?: string;
	latency_ms?: number;
}
export interface GuardrailLogQuery {
	guardrailId?: string;
	policyId?: string;
	page?: number;
	pageSize?: number;
	action?: string;
	startDate?: string;
	endDate?: string;
}
export interface EvaluationSettings {
	prompt: string;
	schema: string;
	model: string;
}
