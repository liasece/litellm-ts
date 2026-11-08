import { describe, expect, it } from "vitest";
import { parseMarkdown, safeMarkdownUrl } from "./MarkdownLogic";

describe("release notes and response Markdown", () => {
	it("keeps GFM tables, checked tasks, and deleted text in the parsed content", () => {
		const tree = parseMarkdown("| Model | Cost |\n| --- | --- |\n| Example | 1 |\n\n- [x] Published\n\n~~old~~");
		expect(tree.children?.map((node) => node.type)).toEqual(["table", "list", "paragraph"]);
		expect(tree.children?.[1].children?.[0].checked).toBe(true);
		expect(tree.children?.[2].children?.[0].type).toBe("delete");
	});

	it("keeps table and strikethrough text literal when a response used CommonMark without GFM", () => {
		const tree = parseMarkdown("| Model | Cost |\n| --- | --- |\n| Example | 1 |\n\n~~old~~", false);
		expect(tree.children?.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
		expect(tree.children?.[1].children?.[0]).toMatchObject({ type: "text", value: "~~old~~" });
	});
	it("blocks executable and data protocols while preserving relative and HTTPS links", () => {
		expect(safeMarkdownUrl("javascript:alert(1)")).toBeUndefined();
		expect(safeMarkdownUrl("data:text/html,test")).toBeUndefined();
		expect(safeMarkdownUrl("/ui/?page=logs")).toBe("/ui/?page=logs");
		expect(safeMarkdownUrl("https://example.test/releases")).toBe("https://example.test/releases");
	});
});
