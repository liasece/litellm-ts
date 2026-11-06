import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTimelineEvent } from "../../networking";
import { SessionSimulationDrawer } from "./SessionSimulationDrawer";

const mockSessionTimelineCall = vi.fn();

vi.mock("../../networking", () => ({
	sessionTimelineCall: (...args: unknown[]) => mockSessionTimelineCall(...args),
}));

vi.mock("@/app/(dashboard)/hooks/logDetails/useSessionTimelineStream", () => ({
	useSessionTimelineStream: () => ({ streaming: false }),
}));

function makeEvent(overrides: Partial<SessionTimelineEvent>): SessionTimelineEvent {
	return {
		id: "req-9:request:0",
		request_id: "req-9",
		role: "user",
		label: "用户输入",
		timestamp: "2026-01-01T00:00:09.000Z",
		model: "claude",
		content: "最近的问题",
		...overrides,
	};
}

const summary = {
	keys: [],
	request_count: 120,
	event_count: 240,
	total_spend: 0,
	total_tokens: 0,
	duration_seconds: 0,
	start_time: null,
	end_time: null,
	filtered_request_count: 0,
	in_progress_request_count: 0,
};

function renderDrawer() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<SessionSimulationDrawer
				open={true}
				onClose={() => undefined}
				sessionGroup={{ type: "session_id", id: "session-1" }}
				accessToken="token"
			/>
		</QueryClientProvider>,
	);
}

describe("Session 模拟窗口", () => {
	beforeEach(() => {
		mockSessionTimelineCall.mockReset();
	});

	it("长会话只显示最近窗口，并按游标把更早的请求拼到前面", async () => {
		mockSessionTimelineCall.mockResolvedValueOnce({
			data: [makeEvent({})],
			summary: summary,
			active_requests: [],
			window: { returned_requests: 50, total_requests: 120, has_more: true, before: "cursor-1", limit: 50 },
		});
		renderDrawer();

		const banner = await screen.findByTestId("session-simulation-window");
		expect(banner.textContent).toContain("已显示最近 50 个请求（会话共 120 个）");
		expect(screen.getByText("最近的问题")).toBeTruthy();

		mockSessionTimelineCall.mockResolvedValueOnce({
			data: [
				makeEvent({
					id: "req-1:request:0",
					request_id: "req-1",
					content: "更早的问题",
					timestamp: "2026-01-01T00:00:00.000Z",
				}),
			],
			summary: summary,
			active_requests: [],
			window: { returned_requests: 50, total_requests: 120, has_more: false, before: null, limit: 50 },
		});
		fireEvent.click(screen.getByTestId("session-simulation-load-earlier"));

		await waitFor(() => expect(screen.getByText("更早的问题")).toBeTruthy());
		// 更早的一页用当前窗口最早的游标请求，而不是从头重读整个会话。
		expect(mockSessionTimelineCall).toHaveBeenLastCalledWith(
			"token",
			{ type: "session_id", id: "session-1" },
			undefined,
			{ before: "cursor-1" },
		);
		// 历史取完后按钮消失，已加载的内容保留。
		await waitFor(() => expect(screen.queryByTestId("session-simulation-load-earlier")).toBeNull());
		expect(screen.getByTestId("session-simulation-window").textContent).toContain("另外加载了更早的 1 个事件");
	});
});
