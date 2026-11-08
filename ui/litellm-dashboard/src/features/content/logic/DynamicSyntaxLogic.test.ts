import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import CodeHighlightComponent from "../ui/CodeHighlightComponent.vue";
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
	it("applies numeric code-block styles with pixel units", async () => {
		const rendered = await renderToString(
			createSSRApp({
				render: () =>
					h(CodeHighlightComponent, {
						code: "print(1)",
						language: "python",
						customStyle: { padding: 16, fontSize: 12, lineHeight: 1.5 },
					}),
			}),
		);
		expect(rendered).toContain("padding:16px");
		expect(rendered).toContain("font-size:12px");
		expect(rendered).toContain("line-height:1.5");
	});
});
