/**
 * 流式详情只更新必要区域。
 *
 * 进行中的请求每 400ms 推一次增量：响应区域和指标区域应该刷新，而请求侧对话、
 * Routing、Metadata 这些静态区域不能跟着整页重渲染——否则长对话每帧都要重新渲染
 * Markdown，页面会明显发飘。
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LogDetailContent } from "./LogDetailContent";
import { LogDetailLiveProvider, readLiveDetailValues } from "./liveDetail";
import type { LogEntry } from "../columns";

const counters = vi.hoisted(() => ({ input: 0, output: 0 }));

vi.mock("./InputCard", () => ({
	InputCard: () => {
		counters.input += 1;
		return <div data-testid="input-card" />;
	},
}));

vi.mock("./OutputCard", () => ({
	OutputCard: ({ message }: { message?: { content?: string } | null }) => {
		counters.output += 1;
		return <div data-testid="output-card">{message?.content ?? ""}</div>;
	},
}));

const MESSAGES = [{ role: "user", content: "hello" }];
const METADATA = { status: "in_progress" };
const PROXY_SERVER_REQUEST = { url: "/v1/chat/completions", method: "POST", body: { model: "gpt-4" } };
const REQUEST_TAGS = {};
// 抽屉传给详情页的回调在真实代码里不会随推送帧变化，这里同样保持引用稳定。
const noop = () => {};

/**
 * 构造进行中的日志条目，静态字段复用常量引用。
 * @param overrides - 需要覆盖的字段
 */
const createEntry = (overrides: Partial<LogEntry> = {}): LogEntry =>
	({
		request_id: "req-streaming",
		api_key: "api-key",
		team_id: "team-id",
		model: "gpt-4",
		model_id: "gpt-4",
		call_type: "chat",
		spend: 0,
		total_tokens: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		startTime: "2025-11-14T00:00:00Z",
		endTime: "2025-11-14T00:00:01Z",
		cache_hit: "miss",
		messages: MESSAGES,
		response: undefined,
		metadata: METADATA,
		proxy_server_request: PROXY_SERVER_REQUEST,
		request_tags: REQUEST_TAGS,
		custom_llm_provider: "openai",
		status: "in_progress",
		...overrides,
	}) as LogEntry;

/**
 * 复刻抽屉的数据流：拆分静态快照与实时值，再把实时值经 Provider 注入。
 * @param props - 当前日志条目
 */
function StreamingHarness({ entry }: { entry: LogEntry }) {
	const live = readLiveDetailValues(entry);
	return (
		<LogDetailLiveProvider response={live.response} metrics={live.metrics}>
			<LogDetailContent logEntry={entry} upstreamLogsEnabled={false} onOpenSettings={noop} />
		</LogDetailLiveProvider>
	);
}

describe("LogDetailContent 流式区域更新", () => {
	it("响应更新时只刷新输出区域，请求侧对话不重渲染", () => {
		counters.input = 0;
		counters.output = 0;
		const { rerender } = render(<StreamingHarness entry={createEntry({ prompt_tokens: 11 })} />);
		const inputRenders = counters.input;
		const outputRenders = counters.output;
		expect(inputRenders).toBe(1);

		rerender(
			<StreamingHarness
				entry={createEntry({
					response: { choices: [{ message: { content: "第一段" } }] },
					prompt_tokens: 11,
					completion_tokens: 4,
					total_tokens: 15,
					request_duration_ms: 612,
				})}
			/>,
		);

		// 请求侧没有变化，不该重渲染。
		expect(counters.input).toBe(inputRenders);
		// 输出区域跟着推送帧更新，并且拿到的是最新内容（不是静态快照里的占位值）。
		expect(counters.output).toBeGreaterThan(outputRenders);
		expect(screen.getByTestId("output-card")).toHaveTextContent("第一段");

		rerender(
			<StreamingHarness
				entry={createEntry({
					response: { choices: [{ message: { content: "第一段第二段" } }] },
					prompt_tokens: 11,
					completion_tokens: 9,
					total_tokens: 20,
					request_duration_ms: 890,
				})}
			/>,
		);

		expect(counters.input).toBe(inputRenders);
		expect(screen.getByTestId("output-card")).toHaveTextContent("第一段第二段");
	});

	it("静态字段变化时请求侧重新渲染，保证详情不被冻结", () => {
		counters.input = 0;
		const { rerender } = render(<StreamingHarness entry={createEntry()} />);
		const inputRenders = counters.input;

		rerender(
			<StreamingHarness
				entry={createEntry({
					messages: [{ role: "user", content: "different prompt" }],
					model_id: "gpt-4-0613",
				})}
			/>,
		);

		expect(counters.input).toBeGreaterThan(inputRenders);
	});
});
