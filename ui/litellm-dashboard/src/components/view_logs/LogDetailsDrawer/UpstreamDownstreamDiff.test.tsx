import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UpstreamDownstreamDiff } from "./UpstreamDownstreamDiff";

describe("UpstreamDownstreamDiff", () => {
	it("renders request and response diffs with foldable unchanged context", async () => {
		const user = userEvent.setup();
		const commonRequest = {
			model: "gpt-4",
			messages: [{ role: "user", content: "hello" }],
			metadata: {
				first: "same",
				second: "same",
				third: "same",
				fourth: "same",
				fifth: "same",
				sixth: "same",
			},
		};

		render(
			<UpstreamDownstreamDiff
				downstreamRequest={{ ...commonRequest, url: "/v1/chat/completions", transform: "downstream" }}
				upstreamRequest={{ ...commonRequest, url: "https://api.example.com/chat/completions", transform: "upstream" }}
				downstreamResponse={{ choices: [{ message: { content: "downstream response" } }] }}
				upstreamResponse={{ choices: [{ message: { content: "upstream response" } }] }}
			/>,
		);

		expect(screen.getByRole("tab", { name: "Request" })).toBeInTheDocument();
		expect(screen.getByText("Downstream")).toBeInTheDocument();
		expect(screen.getByText("Upstream")).toBeInTheDocument();
		const expandButton = screen.getByRole("button", { name: /Expand .* unchanged lines/i });

		await user.click(expandButton);

		expect(screen.queryByRole("button", { name: /Expand .* unchanged lines/i })).not.toBeInTheDocument();
		await user.click(screen.getByRole("tab", { name: "Response" }));
		expect(screen.getByRole("tabpanel").textContent).toContain("upstream response");
	});

	it("shows an identical state when the selected payloads match", () => {
		render(
			<UpstreamDownstreamDiff
				downstreamRequest={{ model: "gpt-4" }}
				upstreamRequest={{ model: "gpt-4" }}
				downstreamResponse={{ status: "ok" }}
				upstreamResponse={{ status: "ok" }}
			/>,
		);

		expect(screen.getByText("No differences — the recorded payloads are identical.")).toBeInTheDocument();
	});

	it("keeps a large array insertion local instead of marking every shifted item as changed", () => {
		const clientTools = Array.from({ length: 260 }, (_, index) => ({
			type: "function",
			name: `client_tool_${String(index).padStart(3, "0")}`,
			description: `Client tool ${index}`,
			parameters: { type: "object", properties: { value: { type: "string" } } },
		}));
		const insertedTool = {
			type: "function",
			name: "litellm__vision_inspect",
			description: "Private vision capability",
			parameters: { type: "object", properties: {} },
		};
		const { container } = render(
			<UpstreamDownstreamDiff
				downstreamRequest={{ body: { tools: clientTools } }}
				upstreamRequest={{ body: { tools: [insertedTool, ...clientTools] } }}
				downstreamResponse={null}
				upstreamResponse={null}
			/>,
		);

		const changedRows = container.querySelectorAll('[data-diff-kind="change"]');
		expect(changedRows.length).toBeGreaterThan(0);
		expect(changedRows.length).toBeLessThan(20);
		expect(Array.from(changedRows).some((row) => row.textContent?.includes("litellm__vision_inspect"))).toBe(true);
		expect(
			Array.from(container.querySelectorAll('[data-diff-kind="context"]')).some((row) =>
				row.textContent?.includes("client_tool_000"),
			),
		).toBe(true);
	});
});
