import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import MarkdownContent from "../ui/MarkdownContent.vue";
import { resolveMarkdownImage, safeMarkdownUrl } from "./MarkdownLogic";
describe("safe message Markdown rendering", () => {
	it("renders reference links, image alt text, GFM tables and fenced code as Vue nodes", async () => {
		const fence = String.fromCharCode(96).repeat(3);
		const source = [
			"[Documentation][docs]",
			"",
			"[docs]: https://example.test/docs",
			"",
			"![Diagram][picture]",
			"",
			"[picture]: https://example.test/image.png",
			"",
			"| Item | Value |",
			"| --- | --- |",
			"| result | ok |",
			"",
			fence + "ts",
			"const x = 1;",
			fence,
		].join("\n");
		const html = await renderToString(createSSRApp(MarkdownContent, { source }));
		expect(html).toContain('href="https://example.test/docs"');
		expect(html).toContain('alt="Diagram"');
		expect(html).toContain("<table>");
		expect(html).toContain('class="language-ts"');
		expect(html).toContain("const x = 1;\n");
		expect(html).not.toContain("const x = 1;\\n");
	});
	it("resolves stored raster images while explaining local images that were not recorded", async () => {
		const src = "data:image/png;base64,aGVsbG8=",
			imageSources = { "/fixture/screenshot.png": src };
		expect(resolveMarkdownImage("/fixture/screenshot.png", imageSources)).toBe(src);
		expect(resolveMarkdownImage("data:image/svg+xml,<svg/>")).toBeUndefined();
		expect(safeMarkdownUrl("java\nscript:alert(1)")).toBeUndefined();
		const html = await renderToString(
			createSSRApp(MarkdownContent, { source: "![Local](/Users/fixture/chart.png)", localImageFallback: true }),
		);
		expect(html).toContain("图片保存在生成设备上");
		expect(html).not.toContain('<img src="/Users');
	});
	it("keeps raw HTML inert and creates footnote references", async () => {
		const source = ["Hello[^note]", "", "[^note]: Footnote text", "", "<script>alert(1)</script>"].join("\n");
		const html = await renderToString(createSSRApp(MarkdownContent, { source }));
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("data-footnote-ref");
		expect(html).toContain("Footnote text");
	});
});
