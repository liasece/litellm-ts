import { describe, expect, it } from "vitest";
import { syntaxSegments } from "./DynamicSyntaxLogic";
describe("Vue dynamic code rendering", () => {
	it("keeps source text unchanged through the supported language aliases", () => {
		const code = 'print("<synthetic>")\n';
		for (const language of [
			"python",
			"py",
			"json",
			"javascript",
			"js",
			"typescript",
			"ts",
			"jsx",
			"tsx",
			"bash",
			"shell",
			"sh",
			"yaml",
			"yml",
			"sql",
			"html",
			"css",
		]) {
			expect(
				syntaxSegments(code, language)
					.map((segment) => segment.text)
					.join(""),
			).toBe(code);
		}
	});
	it("uses plain text for unknown or inherited object property names", () => {
		const code = "<img src=x onerror=alert(1)> & raw text";
		for (const language of ["unknown-synthetic", "constructor", "toString"])
			expect(syntaxSegments(code, language)).toEqual([{ types: [], text: code }]);
	});
});
