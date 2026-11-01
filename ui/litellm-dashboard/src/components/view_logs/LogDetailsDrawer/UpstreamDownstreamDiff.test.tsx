import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UpstreamDownstreamDiff } from "./UpstreamDownstreamDiff";

describe("UpstreamDownstreamDiff", () => {

	it("warns about protocol conversion in both request and response diffs", async () => {
		const user = userEvent.setup();
		render(
			<UpstreamDownstreamDiff
				downstreamRequest={{ url: "/v1/responses", body: { input: "Hello" } }}
				upstreamRequest={JSON.stringify({ url: "https://provider.example/v1/chat/completions", body: { messages: [] } })}
				downstreamResponse={{ output: [] }}
				upstreamResponse={{ choices: [] }}
			/>,
		);
		expect(screen.getByRole("alert")).toHaveTextContent("上下游协议不一致");
		expect(screen.getByRole("alert")).toHaveTextContent("下游使用 Responses，上游使用 Chat Completions");
		expect(screen.getByRole("alert")).toHaveTextContent("即使内容相同也可能被标记为差异");
		await user.click(screen.getByRole("tab", { name: "Response" }));
		expect(screen.getByRole("alert")).toBeVisible();
	});

	it("distinguishes Anthropic Messages from Chat Completions despite their shared messages field", () => {
		render(
			<UpstreamDownstreamDiff
				downstreamRequest={{ url: "/v1/messages", body: { messages: [] } }}
				upstreamRequest={{ url: "/v1/chat/completions", body: { messages: [] } }}
				downstreamResponse={null}
				upstreamResponse={null}
			/>,
		);
		expect(screen.getByRole("alert")).toHaveTextContent("下游使用 Anthropic Messages，上游使用 Chat Completions");
	});

	it.each([
		{
			downstream: { url: "/v1/chat/completions" },
			upstream: { url: "https://provider.example/openai/deployments/model/chat/completions/?api-version=2025-01-01" },
		},
		{ downstream: { url: "/v1/responses" }, upstream: { url: "/custom-endpoint" } },
		{ downstream: "{invalid", upstream: { url: "/v1/responses" } },
	])("does not claim a protocol mismatch for matching or unknown protocols: $downstream", ({ downstream, upstream }) => {
		render(
			<UpstreamDownstreamDiff
				downstreamRequest={downstream}
				upstreamRequest={upstream}
				downstreamResponse={null}
				upstreamResponse={null}
			/>,
		);
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("renders request and response diffs with foldable unchanged context", async () => {
		const user = userEvent.setup();
		// 构造 > CONTEXT_LINES * 2 + 1（101）行相同的字段，使未变化块触发折叠，
		// 从而验证「折叠中间、保留首尾、可点击展开」的交互。
		const commonFields: Record<string, string> = {};
		for (let index = 0; index < 120; index += 1) {
			commonFields[`field_${String(index).padStart(3, "0")}`] = `same_value_${index}`;
		}
		const commonRequest = { model: "gpt-4", ...commonFields };

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

	it("ignores recursive key order for object requests and JSON string responses without mutating inputs", async () => {
		const user = userEvent.setup();
		const downstream = Object.freeze({
			model: "test",
			messages: Object.freeze([Object.freeze({ role: "user", content: Object.freeze({ z: null, a: false }) })]),
		});
		const upstream = { messages: [{ content: { a: false, z: null }, role: "user" }], model: "test" };
		const before = JSON.stringify(downstream);
		render(
			<UpstreamDownstreamDiff
				downstreamRequest={downstream}
				upstreamRequest={upstream}
				downstreamResponse={JSON.stringify(downstream)}
				upstreamResponse={JSON.stringify(upstream)}
			/>,
		);
		expect(screen.getByRole("tabpanel")).toHaveTextContent("No differences");
		await user.click(screen.getByRole("tab", { name: "Response" }));
		expect(screen.getByRole("tabpanel")).toHaveTextContent("No differences");
		expect(JSON.stringify(downstream)).toBe(before);
	});

	it("shows only a changed value after sorting keys lexicographically, including numeric keys", () => {
		const { container } = render(
			<UpstreamDownstreamDiff
				downstreamRequest={JSON.parse('{"z":0,"2":"two","10":"ten","a":{"z":0,"b":1}}')}
				upstreamRequest={JSON.parse('{"a":{"b":2,"z":0},"10":"ten","2":"two","z":0}')}
				downstreamResponse={null}
				upstreamResponse={null}
			/>,
		);
		const changedRows = container.querySelectorAll('[data-diff-kind="change"]');
		expect(changedRows).toHaveLength(1);
		expect(changedRows[0]).toHaveTextContent('"b": 1');
		expect(changedRows[0]).toHaveTextContent('"b": 2');
		const rows = Array.from(container.querySelectorAll("[data-diff-kind]"), (row) => row.textContent ?? "");
		expect(rows.findIndex((row) => row.includes('"10":'))).toBeLessThan(rows.findIndex((row) => row.includes('"2":')));
	});

	it.each([
		{ left: { values: [1, 2] }, right: { values: [2, 1] } },
		{ left: { content: '{"z":1,"a":2}' }, right: { content: '{"a":2,"z":1}' } },
		{ left: "plain text before", right: "plain text after" },
		{ left: '{"broken":', right: '{"broken":false' },
	])("preserves meaningful differences in arrays and strings: $left", ({ left, right }) => {
		const { container } = render(
			<UpstreamDownstreamDiff
				downstreamRequest={left}
				upstreamRequest={right}
				downstreamResponse={null}
				upstreamResponse={null}
			/>,
		);
		expect(screen.queryByText(/No differences/)).not.toBeInTheDocument();
		expect(container.querySelectorAll('[data-diff-kind="change"]').length).toBeGreaterThan(0);
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
