import { complianceFrameworks } from "../../playground/data/PlaygroundComplianceData";
import type { CompliancePrompt } from "../../playground/support/PlaygroundComplianceModels";
export const quickSource = "quick_chat",
	allSource = "__all__";
export const pipelineTestSources = [
	{ value: quickSource, label: "Quick chat (custom message)" },
	...complianceFrameworks.map((f) => ({ value: f.name, label: f.name })),
	{ value: allSource, label: "All compliance datasets" },
];
export function pipelinePrompts(source: string): CompliancePrompt[] {
	if (source === quickSource) return [];
	return (source === allSource ? complianceFrameworks : complianceFrameworks.filter((f) => f.name === source)).flatMap((f) =>
		f.categories.flatMap((c) => c.prompts),
	);
}
export function matchesExpected(expected: "pass" | "fail", terminal: string) {
	return expected === "pass" ? terminal === "allow" || terminal === "modify_response" : terminal === "block";
}
export const actionOptions = [
	{ label: "Next Step", value: "next" },
	{ label: "Allow", value: "allow" },
	{ label: "Block", value: "block" },
	{ label: "Custom Response", value: "modify_response" },
];
export const actionLabels: Record<string, string> = {
	next: "Next Step",
	allow: "Allow",
	block: "Block",
	modify_response: "Custom Response",
};
export const outcomeStyles: Record<string, { backgroundColor: string; color: string }> = {
	pass: { backgroundColor: "#f0fdf4", color: "#16a34a" },
	fail: { backgroundColor: "#fef2f2", color: "#dc2626" },
	error: { backgroundColor: "#fffbeb", color: "#d97706" },
};
export const terminalStyles: Record<string, { backgroundColor: string; color: string }> = {
	allow: outcomeStyles.pass!,
	block: outcomeStyles.fail!,
	modify_response: { backgroundColor: "#eff6ff", color: "#2563eb" },
};
