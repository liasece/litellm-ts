export interface GuardrailTestResult {
	guardrailName: string;
	response_text: string;
	latency: number;
}
export interface GuardrailTestError {
	guardrailName: string;
	error: Error;
	latency: number;
}
