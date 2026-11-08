import { describe, expect, it } from "vitest";
import { csvPrompts, parseCsv, csvText } from "./PlaygroundCsvLogic";
import { complianceCounts, complianceVerdict, filterComplianceResults } from "./PlaygroundComplianceLogic";
import type { ComplianceResult } from "../support/PlaygroundComplianceModels";
describe("compliance datasets and verdicts", () => {
	it("imports quoted commas, Unicode, escaped quotes and multiline prompts without losing text", () => {
		const rows = [
				["prompt", "expected_result", "framework", "category"],
				['你好, say "hello"\nsecond line', "FAIL", "Fixture", "Quoted"],
			],
			csv = csvText(rows),
			prompts = csvPrompts(csv, 42);
		expect(parseCsv(csv)).toEqual(rows);
		expect(prompts[0]).toMatchObject({ id: "csv-42-0", prompt: rows[1][0], expectedResult: "fail", framework: "Fixture" });
		expect(() => csvPrompts("prompt,expected_result\nwrong,maybe")).toThrow('expected_result must be "fail" or "pass"');
		expect(() => parseCsv('"Unclosed')).toThrow("Failed to parse CSV");
	});
	it("derives blocked results from guardrail errors and returns processed/agent text", () => {
		expect(
			complianceVerdict({ guardrail_errors: [{ guardrail_name: "PII", message: "Detected" }], inputs: { texts: ["masked"] } }),
		).toEqual({ actualResult: "blocked", triggeredBy: "PII: Detected", returnedText: "masked" });
		expect(
			complianceVerdict({ agent_response: { choices: [{ message: { content: "Agent output" } }] }, inputs: { texts: ["input"] } })
				.returnedText,
		).toBe("Agent output");
	});
	it("distinguishes false positives, gaps and pending rows for filters and score", () => {
		const base: ComplianceResult = {
				promptId: "a",
				prompt: "Fixture",
				category: "Fixture",
				categoryIcon: "shield",
				expectedResult: "fail",
				actualResult: "allowed",
				isMatch: false,
				status: "complete",
			},
			results = [
				base,
				{ ...base, promptId: "b", expectedResult: "pass" as const, actualResult: "blocked" as const },
				{ ...base, promptId: "c", actualResult: "blocked" as const, isMatch: true },
				{ ...base, promptId: "d", status: "pending" as const },
			];
		expect(complianceCounts(results)).toMatchObject({ matches: 1, falsePositive: 1, falseNegative: 1, pending: 1, score: 33 });
		expect(filterComplianceResults(results, "mismatches").map((row) => row.promptId)).toEqual(["a", "b"]);
	});
});
