import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionSpendLogsCall } from "../../networking";
import type { LogEntry } from "../columns";
import { LogDetailsDrawer } from "./LogDetailsDrawer";

vi.mock("../../networking", () => ({
	sessionSpendLogsCall: vi.fn(),
}));

vi.mock("@/app/(dashboard)/hooks/logDetails/useLogDetails", () => ({
	useLogDetails: vi.fn(() => ({ data: null, isLoading: false })),
}));

vi.mock("./useKeyboardNavigation", () => ({
	useKeyboardNavigation: vi.fn(() => ({ selectNextLog: vi.fn(), selectPreviousLog: vi.fn() })),
}));

vi.mock("./DrawerHeader", () => ({
	DrawerHeader: ({ log }: { log: LogEntry }) => <div data-testid="selected-request">{log.request_id}</div>,
}));

vi.mock("./LogDetailContent", () => ({
	LogDetailContent: ({ logEntry }: { logEntry: LogEntry }) => <div>details:{logEntry.request_id}</div>,
	GuardrailJumpLink: () => null,
}));

vi.mock("antd", () => ({
	Drawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div role="dialog">{children}</div> : null,
	Button: ({ children, onClick, disabled, loading, ...props }: any) => (
		<button type="button" onClick={onClick} disabled={disabled || loading} {...props}>
			{children}
		</button>
	),
	Alert: ({ message, description, action }: any) => (
		<div role="alert">
			<div>{message}</div>
			<div>{description}</div>
			{action}
		</div>
	),
}));

const clickedLog: LogEntry = {
	request_id: "req-clicked",
	api_key: "key",
	team_id: "team",
	model: "model-a",
	model_id: "model-a-id",
	call_type: "completion",
	spend: 0.1,
	total_tokens: 10,
	prompt_tokens: 6,
	completion_tokens: 4,
	startTime: "2026-07-24T10:00:00.000Z",
	endTime: "2026-07-24T10:00:01.000Z",
	cache_hit: "miss",
	messages: [],
	response: {},
	metadata: { status: "success" },
	session_id: "session-A",
};

const secondLog: LogEntry = {
	...clickedLog,
	request_id: "req-second",
	model: "model-second",
	startTime: "2026-07-24T10:00:02.000Z",
	endTime: "2026-07-24T10:00:03.000Z",
};

const claudeCodeGroup = {
	type: "claude_code_user_id",
	id: "user_device_account__session_123e4567-e89b-12d3-a456-426614174000",
} as const;

function renderDrawer(sessionGroup = claudeCodeGroup, teamId?: string) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	});
	const view = render(
		<QueryClientProvider client={queryClient}>
			<LogDetailsDrawer
				open={true}
				onClose={vi.fn()}
				logEntry={clickedLog}
				sessionGroup={sessionGroup}
				teamId={teamId}
				accessToken="unused-token"
			/>
		</QueryClientProvider>,
	);
	return { ...view, queryClient };
}

describe("LogDetailsDrawer session fallback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("完整 group ref 与显式 team scope 透传，query key 隔离 scope", async () => {
		vi.mocked(sessionSpendLogsCall).mockResolvedValue({ data: [clickedLog], snapshot: "snap-1", next_cursor: null });

		const { queryClient } = renderDrawer(claudeCodeGroup, "scope-team");

		await waitFor(() =>
			expect(sessionSpendLogsCall).toHaveBeenCalledWith("unused-token", claudeCodeGroup, {
				pageSize: 100,
				teamId: "scope-team",
			}),
		);
		expect(
			queryClient
				.getQueryCache()
				.find({ queryKey: ["sessionLogs", claudeCodeGroup.type, claudeCodeGroup.id, "scope-team"] }),
		).toBeDefined();
	});

	it("Session 请求 pending 时仍显示被点击请求", () => {
		vi.mocked(sessionSpendLogsCall).mockReturnValue(new Promise(() => undefined));

		renderDrawer();

		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByTestId("selected-request")).toHaveTextContent("req-clicked");
		expect(screen.getByText("details:req-clicked")).toBeInTheDocument();
	});

	it("Session 请求失败时保留 fallback，显示清洗错误和 Retry", async () => {
		vi.mocked(sessionSpendLogsCall).mockRejectedValue(new Error("HTTP 404"));

		renderDrawer();

		expect(await screen.findByRole("alert")).toHaveTextContent("完整 Session 加载失败");
		expect(screen.getByRole("alert")).toHaveTextContent("HTTP 404");
		expect(screen.getByTestId("selected-request")).toHaveTextContent("req-clicked");
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
	});

	it("首次失败后 Retry 成功恢复完整列表并保持点击请求选中", async () => {
		vi.mocked(sessionSpendLogsCall)
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValueOnce({ data: [clickedLog, secondLog] });

		renderDrawer();
		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

		await waitFor(() => expect(screen.getByText("model-second")).toBeInTheDocument());
		expect(screen.getAllByRole("button")).toHaveLength(4);
		expect(screen.getByTestId("selected-request")).toHaveTextContent("req-clicked");
	});

	it("成功分页包络展示多条 Session 事件", async () => {
		vi.mocked(sessionSpendLogsCall).mockResolvedValue({
			data: [clickedLog, secondLog],
			total: 2,
			page: 1,
			page_size: 50,
			total_pages: 1,
		});

		renderDrawer();

		await waitFor(() => expect(screen.getByText("model-second")).toBeInTheDocument());
		expect(screen.getAllByRole("button")).toHaveLength(4);
	});

	it("异常 total_pages 进入整体 fallback 且不继续请求", async () => {
		vi.mocked(sessionSpendLogsCall).mockResolvedValue({
			data: [clickedLog],
			total: 1,
			page: 1,
			page_size: 100,
			total_pages: 1001,
		});

		renderDrawer();

		expect(await screen.findByRole("alert")).toHaveTextContent("invalid total_pages");
		expect(sessionSpendLogsCall).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("selected-request")).toHaveTextContent("req-clicked");
	});

	it("消费 snapshot + next_cursor 拉取超过 100 条，同 startTime 边界无重复遗漏且固定服务端快照", async () => {
		const boundaryTime = "2026-07-24T10:00:00.000Z";
		const firstPage = Array.from({ length: 100 }, (_, index) => ({
			...clickedLog,
			request_id: `req-page-1-${index}`,
			model: `model-page-1-${index}`,
			spend: 0.01,
			startTime: index === 99 ? boundaryTime : `2026-07-24T09:59:${String(index % 60).padStart(2, "0")}.000Z`,
			endTime: `2026-07-24T10:00:${String(index % 60).padStart(2, "0")}.500Z`,
		}));
		const boundaryLog = {
			...secondLog,
			request_id: "req-same-time-boundary",
			model: "model-same-time-boundary",
			startTime: boundaryTime,
			spend: 0.25,
		};
		const stableTail = {
			...secondLog,
			request_id: "req-stable-tail",
			model: "model-stable-tail",
			spend: 0.25,
		};
		vi.mocked(sessionSpendLogsCall)
			.mockResolvedValueOnce({ data: firstPage, snapshot: "snapshot-fixed", next_cursor: "cursor-100" })
			.mockResolvedValueOnce({ data: [boundaryLog, stableTail], snapshot: "snapshot-fixed", next_cursor: null });

		renderDrawer(claudeCodeGroup, "scope-team");

		await waitFor(() => expect(screen.getByText("model-stable-tail")).toBeInTheDocument());
		expect(screen.getByText("model-same-time-boundary")).toBeInTheDocument();
		expect(sessionSpendLogsCall).toHaveBeenNthCalledWith(1, "unused-token", claudeCodeGroup, {
			pageSize: 100,
			teamId: "scope-team",
		});
		expect(sessionSpendLogsCall).toHaveBeenNthCalledWith(2, "unused-token", claudeCodeGroup, {
			pageSize: 100,
			teamId: "scope-team",
			snapshot: "snapshot-fixed",
			cursor: "cursor-100",
		});
		expect(screen.getByText(/102 req/)).toBeInTheDocument();
		expect(screen.getByText(/\$1\.500000/)).toBeInTheDocument();
	});
});
