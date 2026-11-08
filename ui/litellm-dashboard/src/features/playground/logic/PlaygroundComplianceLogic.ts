import type { ComplianceFramework, CompliancePrompt, ComplianceResult, ComplianceFilter } from "../support/PlaygroundComplianceModels";
import { asRecord, records } from "./PlaygroundValueLogic";
import { csvText } from "./PlaygroundCsvLogic";
export function combinedFrameworks(builtIn: ComplianceFramework[], custom: CompliancePrompt[]): ComplianceFramework[] {
	const groups = new Map<string, ComplianceFramework>();
	for (const prompt of custom) {
		let group = groups.get(prompt.framework);
		if (!group) {
			group = {
				name: prompt.framework,
				icon: prompt.categoryIcon || "file-text",
				description: "Custom prompts — " + prompt.framework + ".",
				categories: [],
			};
			groups.set(prompt.framework, group);
		}
		let category = group.categories.find((category) => category.name === prompt.category);
		if (!category) {
			category = {
				name: prompt.category,
				icon: prompt.categoryIcon || "file-text",
				description: prompt.categoryDescription || "",
				prompts: [],
			};
			group.categories.push(category);
		}
		category.prompts.push(prompt);
	}
	return [...groups.values(), ...builtIn];
}
export function filterFrameworks(frameworks: ComplianceFramework[], search: string) {
	return frameworks
		.map((framework) => ({
			...framework,
			categories: framework.categories
				.map((category) => ({
					...category,
					prompts: category.prompts.filter((prompt) => !search || prompt.prompt.toLowerCase().includes(search.toLowerCase())),
				}))
				.filter((category) => category.prompts.length),
		}))
		.filter((framework) => framework.categories.length);
}
export function complianceVerdict(value: unknown) {
	const item = asRecord(value),
		errors = records(item?.guardrail_errors),
		actualResult = errors.length ? ("blocked" as const) : ("allowed" as const),
		triggeredBy = errors.length
			? errors.map((error) => String(error.guardrail_name) + ": " + String(error.message)).join("; ")
			: undefined;
	const agent = asRecord(item?.agent_response),
		message = asRecord(records(agent?.choices)[0]?.message),
		texts = asRecord(item?.inputs)?.texts;
	const returnedText =
		message?.content !== undefined && message.content !== null
			? String(message.content)
			: Array.isArray(texts) && typeof texts[0] === "string"
				? texts[0]
				: undefined;
	return { actualResult, triggeredBy, returnedText };
}
export function complianceCounts(results: ComplianceResult[]) {
	const completed = results.filter((result) => result.status === "complete"),
		matches = completed.filter((result) => result.isMatch).length,
		falsePositive = completed.filter((result) => result.expectedResult === "pass" && result.actualResult === "blocked").length,
		falseNegative = completed.filter((result) => result.expectedResult === "fail" && result.actualResult === "allowed").length;
	return {
		completed: completed.length,
		matches,
		mismatches: completed.length - matches,
		falsePositive,
		falseNegative,
		pending: results.length - completed.length,
		score: completed.length ? Math.round((matches / completed.length) * 100) : 0,
	};
}
export function filterComplianceResults(results: ComplianceResult[], filter: ComplianceFilter) {
	return results.filter((result) =>
		filter === "matches"
			? result.status === "complete" && result.isMatch
			: filter === "mismatches"
				? result.status === "complete" && !result.isMatch
				: filter === "pending"
					? result.status !== "complete"
					: true,
	);
}
export function complianceExport(results: ComplianceResult[]) {
	return csvText([
		["prompt_id", "prompt", "category", "expected_result", "actual_result", "is_match", "status", "triggered_by", "returned_text"],
		...results.map((result) => [
			result.promptId,
			result.prompt,
			result.category,
			result.expectedResult,
			result.actualResult,
			result.isMatch ? "yes" : "no",
			result.status,
			result.triggeredBy ?? "",
			result.returnedText ?? "",
		]),
	]);
}
export const categoryIconNames: Record<string, string> = {
	lock: "Lock",
	brain: "Brain",
	"bar-chart": "BarChart3",
	scale: "Scale",
	search: "Search",
	smile: "Smile",
	fingerprint: "Fingerprint",
	"trash-2": "Trash2",
	"check-circle": "CheckCircle2",
	"trending-down": "TrendingDown",
	bot: "Bot",
	pencil: "Pencil",
	shield: "Shield",
	"file-text": "FileText",
};
