import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessagePartsView } from "./MessagePartsView";

describe("MessagePartsView", () => {
	it("将生成图片 part 渲染为图片而不是 base64 文本", () => {
		const source = "data:image/png;base64,iVBORw0KGgoAAA";
		render(
			<MessagePartsView
				parts={[
					{
						kind: "image",
						label: "Generated image",
						text: "世界杯主题海报",
						data: { src: source, mimeType: "image/png" },
					},
				]}
			/>,
		);

		expect(screen.getByRole("img", { name: "世界杯主题海报" })).toHaveAttribute("src", source);
		expect(screen.getByText("世界杯主题海报")).toBeInTheDocument();
		expect(screen.queryByText(source)).not.toBeInTheDocument();
	});

	it("将历史截断图片显示为说明而不是损坏的 img", () => {
		const { container } = render(
			<MessagePartsView
				parts={[
					{
						kind: "image",
						label: "Image",
						text: "data:image/png;base64,iVBORw0KGgo... (litellm_truncated skipped 100000 chars. Truncation is a DB storage safeguard.) ...IEND",
					},
				]}
			/>,
		);

		expect(screen.getByText("图片数据在日志入库时被截断，无法显示。")).toBeInTheDocument();
		expect(container.querySelector("img")).not.toBeInTheDocument();
	});

	it("将匹配的工具输出渲染在工具请求卡片内", () => {
		const { container } = render(
			<MessagePartsView
				parts={[
					{
						kind: "tool_call",
						label: "Function call",
						id: "tool-1",
						name: "search",
						data: { q: "world cup" },
					},
					{
						kind: "tool_result",
						label: "Tool result",
						id: "tool-1",
						text: "search result",
					},
				]}
			/>,
		);

		const toolOutput = container.querySelector('[data-tool-output-for="tool-1"]');
		expect(toolOutput).toContainElement(screen.getByText("工具输出"));
		expect(toolOutput).toContainElement(screen.getByText("search result"));
		expect(screen.queryByText("Tool result")).not.toBeInTheDocument();
	});

	it("在 Function result 内渲染结构化图片内容", () => {
		const source = "data:image/png;base64,iVBORw0KGgoAAA";
		render(
			<MessagePartsView
				parts={[
					{
						kind: "tool_result",
						label: "Function result",
						text: "Image Size: 100x100.\n[Image]",
						parts: [
							{ kind: "text", label: "Text", text: "Image Size: 100x100." },
							{ kind: "image", label: "Image", text: source, data: { src: source, mimeType: "image/png" } },
						],
					},
				]}
			/>,
		);

		expect(screen.getByText("Function result")).toBeInTheDocument();
		expect(screen.getByText("Image Size: 100x100.")).toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Image" })).toHaveAttribute("src", source);
		expect(screen.queryByText(source)).not.toBeInTheDocument();
	});
	it("将回放中已关联的本地 Markdown 图片渲染为可预览的原图", () => {
		const path = "/Users/example/outputs/golden-retriever.png";
		const source = "data:image/png;base64,iVBORw0KGgoAAA";
		render(
			<MessagePartsView
				parts={[{ kind: "text", label: "Text", text: `![金毛幼犬](${path})` }]}
				imageSources={{ [path]: source }}
			/>,
		);
		expect(screen.getByRole("img", { name: "金毛幼犬" })).toHaveAttribute("src", source);
	});

	it("保留 Markdown 中的栅格图片数据，并继续阻止活动内容链接", () => {
		const source = "data:image/png;base64,iVBORw0KGgoAAA";
		render(
			<MessagePartsView
				parts={[
					{
						kind: "text",
						label: "Text",
						text: `![小狗](${source})\n[unsafe](javascript:alert%281%29)\n[inline](data:text/html;base64,PHNjcmlwdD4=)`,
					},
				]}
			/>,
		);
		expect(screen.getByRole("img", { name: "小狗" })).toHaveAttribute("src", source);
		expect(screen.getByText("unsafe").closest("a")).toHaveAttribute("href", "");
		expect(screen.getByText("inline").closest("a")).toHaveAttribute("href", "");
	});

	it("本地文件没有可关联的图片数据时显示原因，避免请求错误的网站路径", () => {
		const { container } = render(
			<MessagePartsView
				parts={[{ kind: "text", label: "Text", text: "![金毛幼犬](/Users/example/outputs/golden-retriever.png)" }]}
			/>,
		);
		expect(container.querySelector("img")).not.toBeInTheDocument();
		expect(screen.getByText("图片保存在生成设备上，日志中没有可显示的图片数据。")).toBeInTheDocument();
	});
	it("渲染带空格的本地 Markdown 图片路径", () => {
		const path = "/Users/example/My images/dog.png";
		const source = "data:image/png;base64,iVBORw0KGgoAAA";
		render(
			<MessagePartsView
				parts={[{ kind: "text", label: "Text", text: `![幼犬](<${path}>)` }]}
				imageSources={{ [path]: source }}
			/>,
		);
		expect(screen.getByRole("img", { name: "幼犬" })).toHaveAttribute("src", source);
	});

	it.each(["image/svg+xml", "text/html"])("不渲染 Markdown 中的活动内容 %s", (mime) => {
		const { container } = render(
			<MessagePartsView parts={[{ kind: "text", label: "Text", text: `![unsafe](data:${mime};base64,PHN2Zz4=)` }]} />,
		);
		expect(container.querySelector("img")).not.toBeInTheDocument();
	});
});
