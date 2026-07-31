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
});
