import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpendLogsTable, { RequestViewer } from "./index";
import { createColumns, getSessionGroupKey, getSessionGroupRef, type LogEntry } from "./columns";
import { uiSpendLogsCall } from "../networking";
import type { ColumnDef, Row } from "@tanstack/react-table";
import type { Team } from "../key_team_helpers/key_list";
import { renderWithProviders } from "../../../tests/test-utils";
import { useLogFilterLogic } from "./log_filter_logic";

const mockHandleFilterResetFromHook = vi.fn();
const mockRefetchFilteredLogs = vi.fn().mockResolvedValue(undefined);
let mockFilters: Record<string, string> = {};
let mockFilteredLogs = { data: [] as LogEntry[], total: 0, page: 1, page_size: 50, total_pages: 1 };
let mockHasBackendFilters = false;
vi.mock("./log_filter_logic", () => ({
	useLogFilterLogic: vi.fn(() => ({
		filters: mockFilters,
		filteredLogs: mockFilteredLogs,
		hasBackendFilters: mockHasBackendFilters,
		allTeams: [],
		handleFilterChange: vi.fn(),
		handleFilterReset: mockHandleFilterResetFromHook,
		refetchFilteredLogs: mockRefetchFilteredLogs,
	})),
}));

vi.mock("../networking", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../networking")>();
	return {
		...actual,
		uiSpendLogsCall: vi.fn().mockResolvedValue({
			data: [],
			total: 0,
			page: 1,
			page_size: 50,
			total_pages: 0,
		}),
		keyListCall: vi.fn().mockResolvedValue({ keys: [] }),
		keyInfoV1Call: vi.fn().mockResolvedValue({ info: {} }),
		allEndUsersCall: vi.fn().mockResolvedValue([]),
	};
});

vi.mock("../key_team_helpers/filter_helpers", () => ({
	fetchAllTeams: vi.fn().mockResolvedValue([]),
}));

const { mockDrawerProps, mockSimulationDrawerProps } = vi.hoisted(() => ({
	mockDrawerProps: { current: null as any },
	mockSimulationDrawerProps: { current: null as any },
}));
vi.mock("./LogDetailsDrawer", () => ({
	LogDetailsDrawer: (props: any) => {
		mockDrawerProps.current = props;
		return props.open ? <div data-testid="log-details-drawer" /> : null;
	},
	SessionSimulationDrawer: (props: any) => {
		mockSimulationDrawerProps.current = props;
		return props.open ? (
			<div data-testid="session-simulation-drawer">
				<button
					type="button"
					onClick={() =>
						props.onOpenLog?.({
							request_id: "req-from-simulation",
							model: "claude",
							timestamp: "2026-07-24T10:00:00.000Z",
							status: "success",
						})
					}
				>
					打开模拟日志
				</button>
			</div>
		) : null;
	},
}));

vi.mock("./table", () => ({
	DataTable: ({
		columns,
		data,
		onRowClick,
	}: {
		columns: ColumnDef<LogEntry>[];
		data: LogEntry[];
		onRowClick?: (log: LogEntry) => void;
	}) => {
		const sessionColumn = columns.find((column) => column.header === "Session ID");
		return (
			<div>
				{data.map((log) => (
					<div key={log.request_id} onClick={() => onRowClick?.(log)}>
						<span>{log.request_id}</span>
						{sessionColumn && typeof sessionColumn.cell === "function"
							? sessionColumn.cell({ row: { original: log } } as never)
							: null}
					</div>
				))}
			</div>
		);
	},
}));

const baseLogEntry: LogEntry = {
	request_id: "chatcmpl-test-id",
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
	endTime: "2025-11-14T00:00:00Z",
	cache_hit: "miss",
	request_duration_ms: 1000,
	messages: [{ role: "user", content: "hello" }],
	response: { status: "ok" },
	metadata: {
		status: "success",
		additional_usage_values: {
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
		},
	},
	request_tags: {},
	custom_llm_provider: "openai",
	api_base: "https://api.example.com",
};

const createRow = (overrides: Partial<LogEntry> = {}): Row<LogEntry> =>
	({
		original: {
			...baseLogEntry,
			...overrides,
		},
	}) as unknown as Row<LogEntry>;

describe("Request Viewer", () => {
	it("renders the request details heading", () => {
		render(<RequestViewer row={createRow()} />);
		expect(screen.getByText("Request Details")).toBeInTheDocument();
	});

	it("should truncate the request id if it is longer than 64 characters", () => {
		const LONG_REQUEST_ID = "a".repeat(128);
		const TRUNCATED_REQUEST_ID = `${"a".repeat(64)}...`;
		render(
			<RequestViewer
				row={createRow({
					request_id: LONG_REQUEST_ID,
				})}
			/>,
		);

		expect(screen.getByText(TRUNCATED_REQUEST_ID)).toBeInTheDocument();
	});

	it("should display LiteLLM Overhead when litellm_overhead_time_ms is present in metadata", () => {
		render(
			<RequestViewer
				row={createRow({
					metadata: {
						status: "success",
						litellm_overhead_time_ms: 150,
						additional_usage_values: {
							cache_read_input_tokens: 0,
							cache_creation_input_tokens: 0,
						},
					},
				})}
			/>,
		);

		expect(screen.getByText("LiteLLM Overhead:")).toBeInTheDocument();
		expect(screen.getByText("150 ms")).toBeInTheDocument();
	});

	it("should not display LiteLLM Overhead when litellm_overhead_time_ms is not present in metadata", () => {
		render(<RequestViewer row={createRow()} />);

		expect(screen.queryByText("LiteLLM Overhead:")).not.toBeInTheDocument();
	});

	it("should display retry count when attempted_retries > 0 in metadata", () => {
		render(
			<RequestViewer
				row={createRow({
					metadata: {
						status: "success",
						attempted_retries: 2,
						max_retries: 3,
						additional_usage_values: {
							cache_read_input_tokens: 0,
							cache_creation_input_tokens: 0,
						},
					},
				})}
			/>,
		);

		expect(screen.getByText("Retries:")).toBeInTheDocument();
		expect(screen.getByText("2 / 3")).toBeInTheDocument();
	});

	it("should display green 'None' tag when attempted_retries is 0", () => {
		render(
			<RequestViewer
				row={createRow({
					metadata: {
						status: "success",
						attempted_retries: 0,
						max_retries: 3,
						additional_usage_values: {
							cache_read_input_tokens: 0,
							cache_creation_input_tokens: 0,
						},
					},
				})}
			/>,
		);

		expect(screen.getByText("Retries:")).toBeInTheDocument();
		expect(screen.getByText("None")).toBeInTheDocument();
	});

	it("should display '-' for Retries when attempted_retries is not present in metadata", () => {
		render(<RequestViewer row={createRow()} />);

		expect(screen.getByText("Retries:")).toBeInTheDocument();
		expect(screen.getByText("-")).toBeInTheDocument();
	});
});

describe("Logs columns", () => {
	it("Claude Code group 使用 type + 完整 ID 生成 key", () => {
		const group = getSessionGroupRef({
			...baseLogEntry,
			session_id: "random-session",
			session_group_type: "claude_code_user_id",
			session_group_id: "user_device_account__session_123e4567-e89b-12d3-a456-426614174000",
		});

		expect(group).toEqual({
			type: "claude_code_user_id",
			id: "user_device_account__session_123e4567-e89b-12d3-a456-426614174000",
		});
		expect(getSessionGroupKey(group)).toBe(
			"claude_code_user_id\u0000user_device_account__session_123e4567-e89b-12d3-a456-426614174000",
		);
	});

	it("旧响应缺少 group 字段时回退顶层 session_id", () => {
		expect(getSessionGroupRef({ ...baseLogEntry, session_id: "legacy-session" })).toEqual({
			type: "session_id",
			id: "legacy-session",
		});
		expect(getSessionGroupRef(baseLogEntry)).toBeNull();
	});

	const renderColumnCell = (header: string, entry: LogEntry) => {
		const column = createColumns().find((candidate) => candidate.header === header);
		if (!column || typeof column.cell !== "function") {
			throw new Error(`Missing ${header} cell renderer`);
		}

		return render(
			column.cell({
				getValue: () =>
					header === "Model"
						? entry.model
						: header === "Duration (s)"
							? entry.request_duration_ms
							: header === "Cost"
								? entry.spend
								: entry.total_tokens,
				row: { original: entry },
			} as never),
		);
	};

	it("renders Session ID as a link that opens its complete session without bubbling to the row", async () => {
		const user = userEvent.setup();
		const onSessionClick = vi.fn();
		const onRowClick = vi.fn();
		const sessionId = "user_device_account__session_123e4567-e89b-12d3-a456-426614174000";
		const sessionColumn = createColumns().find((candidate) => candidate.header === "Session ID");
		if (!sessionColumn || typeof sessionColumn.cell !== "function") {
			throw new Error("Missing Session ID cell renderer");
		}
		const entry = {
			...baseLogEntry,
			session_id: "random-session",
			session_group_type: "claude_code_user_id" as const,
			session_group_id: sessionId,
			onSessionClick,
		};

		render(
			<div onClick={onRowClick}>
				{sessionColumn.cell({
					getValue: () => sessionId,
					row: { original: entry },
				} as never)}
			</div>,
		);

		await user.click(screen.getByRole("link", { name: sessionId }));
		expect(onSessionClick).toHaveBeenCalledWith({ type: "claude_code_user_id", id: sessionId });
		expect(onRowClick).not.toHaveBeenCalled();
	});

	it("renders an explicit In Progress status instead of treating it as Success", () => {
		renderColumnCell("Status", {
			...baseLogEntry,
			status: "in_progress",
			metadata: { status: "in_progress" },
		});

		expect(screen.getByText("In Progress")).toHaveClass("bg-amber-100", "text-amber-800");
	});

	it("renders an explicit Aborted status for requests recovered after a server restart", () => {
		renderColumnCell("Status", {
			...baseLogEntry,
			request_id: "req-aborted",
			status: "aborted",
			metadata: {
				status: "aborted",
				termination_reason: "server_restart",
			},
		});

		expect(screen.getByText("Aborted")).toHaveClass("bg-orange-100", "text-orange-800");
	});

	it("Cost 悬停时分别显示缓存输入、输入和输出费用", async () => {
		const user = userEvent.setup();
		renderColumnCell("Cost", {
			...baseLogEntry,
			spend: 0.006,
			metadata: {
				status: "success",
				cost_breakdown: {
					cache_input_cost: 0.001,
					input_cost: 0.002,
					output_cost: 0.003,
					total_cost: 0.006,
				},
			},
		});

		await user.hover(screen.getByText("$0.006000"));

		const tooltip = await screen.findByLabelText("Cost breakdown");
		expect(tooltip).toHaveTextContent("缓存输入$0.00100000");
		expect(tooltip).toHaveTextContent("输入$0.00200000");
		expect(tooltip).toHaveTextContent("输出$0.00300000");
	});

	it("旧日志缺少缓存费用字段时从无附加费用的总价安全推导", async () => {
		const user = userEvent.setup();
		renderColumnCell("Cost", {
			...baseLogEntry,
			spend: 0.006,
			metadata: {
				status: "success",
				cost_breakdown: {
					input_cost: 0.002,
					output_cost: 0.003,
					total_cost: 0.006,
					tool_usage_cost: 0,
				},
			},
		});

		await user.hover(screen.getByText("$0.006000"));

		expect(await screen.findByLabelText("Cost breakdown")).toHaveTextContent("缓存输入$0.00100000");
	});

	it("removes only the matching provider prefix while preserving the original model tooltip and provider icon", async () => {
		const user = userEvent.setup();
		renderColumnCell("Model", {
			...baseLogEntry,
			model: "OpenAI/gpt-4o",
			custom_llm_provider: "openai",
		});

		const displayModel = screen.getByText("gpt-4o");
		expect(displayModel).toBeInTheDocument();
		expect(document.querySelector("img")).toBeInTheDocument();

		await user.hover(displayModel);
		const modelInfo = await screen.findByLabelText("Model information");
		expect(modelInfo).toHaveTextContent("Provideropenai");
		expect(modelInfo).toHaveTextContent("显示模型gpt-4o");
		expect(modelInfo).toHaveTextContent("ExecutedOpenAI/gpt-4o");
	});

	it("shows alias resolution in the model tooltip without increasing fallback count", async () => {
		const user = userEvent.setup();
		renderColumnCell("Model", {
			...baseLogEntry,
			model: "alias-a",
			metadata: {
				fallback_models: ["alias-a", "fallback-model"],
				model_resolution_chain: [
					{
						fallback_index: 0,
						input_model: "alias-a",
						resolved_model: "model-a",
						resolution_path: ["alias-a", "alias-b", "model-a"],
					},
				],
			},
		});

		expect(screen.getByText("(1)")).toBeInTheDocument();
		const displayModel = screen.getByText("alias-a");
		await user.hover(displayModel);
		const modelInfo = await screen.findByLabelText("Model information");
		expect(modelInfo).toHaveTextContent("Requestalias-a");
		expect(modelInfo).toHaveTextContent("Aliasalias-a → alias-b");
		expect(modelInfo).toHaveTextContent("Aliasalias-b → model-a");
	});

	it("does not remove a non-matching or nested gateway prefix", () => {
		const { rerender } = renderColumnCell("Model", {
			...baseLogEntry,
			model: "anthropic/claude-sonnet-4",
			custom_llm_provider: "openai",
		});
		expect(screen.getByText("anthropic/claude-sonnet-4")).toBeInTheDocument();

		const column = createColumns().find((candidate) => candidate.header === "Model");
		if (!column || typeof column.cell !== "function") {
			throw new Error("Missing Model cell renderer");
		}
		const nestedEntry = {
			...baseLogEntry,
			model: "gateway/openai/gpt-4o",
			custom_llm_provider: "openai",
		};
		rerender(
			column.cell({
				getValue: () => nestedEntry.model,
				row: { original: nestedEntry },
			} as never),
		);
		expect(screen.getByText("gateway/openai/gpt-4o")).toBeInTheDocument();
	});

	it("shows cache read plus non-cache-read input and output as distinct compact values", async () => {
		const user = userEvent.setup();
		renderColumnCell("Tokens", {
			...baseLogEntry,
			total_tokens: 120,
			prompt_tokens: 100,
			completion_tokens: 20,
			metadata: {
				...baseLogEntry.metadata,
				additional_usage_values: {
					cache_read_input_tokens: 1_299_321,
					cache_creation_input_tokens: 1_299_321,
				},
			},
		});

		const tokenSummary = screen.getByLabelText("Cache read 1299321, input 0, output 20");
		expect(tokenSummary).toHaveTextContent("1,299,321020");
		expect(tokenSummary).not.toHaveTextContent(/[+/]/);
		expect(tokenSummary).toHaveClass("grid", "w-72", "grid-cols-3", "text-left", "text-current");
		expect(screen.queryByText("120")).not.toBeInTheDocument();
		expect(screen.queryByText(/Input:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Cache read:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Cache creation:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Output:/)).not.toBeInTheDocument();

		for (const column of [
			screen.getByLabelText("Cache read 1299321 tokens"),
			screen.getByLabelText("Input 0 tokens"),
			screen.getByLabelText("Output 20 tokens"),
		]) {
			expect(column).toHaveClass("flex", "min-w-0", "w-full", "items-center", "text-left");
			expect(column.className).not.toMatch(
				/bg-violet|border-violet|text-violet|text-gray-700|text-blue-600|font-semibold/,
			);
		}

		const icons = tokenSummary.querySelectorAll("svg");
		expect(icons).toHaveLength(3);
		expect(icons[0]).toHaveClass("lucide-database");
		expect(icons[1]).toHaveClass("lucide-arrow-down-to-line");
		expect(icons[2]).toHaveClass("lucide-arrow-up-from-line");
		for (const icon of icons) {
			expect(icon).toHaveAttribute("width", "12");
			expect(icon).toHaveAttribute("height", "12");
			expect(icon).toHaveAttribute("aria-hidden", "true");
		}

		await user.hover(tokenSummary);
		expect(await screen.findByText(/Cache read \+ input \/ output/)).toBeInTheDocument();
		expect(screen.getByText(/Cache creation: 1,299,321 \(included in input\)/)).toBeInTheDocument();
	});

	it("uses the same compact format when cache metadata is absent", () => {
		renderColumnCell("Tokens", {
			...baseLogEntry,
			total_tokens: 120,
			prompt_tokens: 100,
			completion_tokens: 20,
			metadata: undefined,
		});

		expect(screen.getByLabelText("Cache read 0, input 100, output 20")).toHaveTextContent("010020");
	});

	it("shows cached read from OpenAI input_tokens_details for existing logs", () => {
		renderColumnCell("Tokens", {
			...baseLogEntry,
			total_tokens: 127_423,
			prompt_tokens: 123_717,
			completion_tokens: 3_706,
			metadata: {
				additional_usage_values: {
					input_tokens: 123_717,
					output_tokens: 3_706,
					input_tokens_details: {
						cached_tokens: 118_144,
						cache_write_tokens: 0,
					},
				},
			},
		});

		expect(screen.getByLabelText("Cache read 118144, input 5573, output 3706")).toHaveTextContent("118,1445,5733,706");
	});

	it("clamps input to zero when cache read exceeds prompt tokens", () => {
		renderColumnCell("Tokens", {
			...baseLogEntry,
			prompt_tokens: 100,
			completion_tokens: 20,
			metadata: {
				additional_usage_values: {
					cache_read_input_tokens: 130,
				},
			},
		});

		expect(screen.getByLabelText("Cache read 130, input 0, output 20")).toHaveTextContent("130020");
	});

	it("uses independent green progress scales for cache, input, and output tokens", () => {
		renderColumnCell("Tokens", {
			...baseLogEntry,
			prompt_tokens: 110_000,
			completion_tokens: 1_000,
			metadata: {
				additional_usage_values: {
					cache_read_input_tokens: 100_000,
				},
			},
		});

		for (const testId of ["cache-tokens-progress", "input-tokens-progress", "output-tokens-progress"]) {
			expect(screen.getByTestId(testId)).toHaveStyle({ clipPath: "inset(0 50% 0 0)" });
			expect(screen.getByTestId(testId)).toHaveClass(
				"inset-0",
				"bg-gradient-to-r",
				"from-transparent",
				"via-green-400/15",
				"to-green-500/30",
			);
		}
	});

	it("caps each token progress bar at its own maximum", () => {
		renderColumnCell("Tokens", {
			...baseLogEntry,
			prompt_tokens: 230_001,
			completion_tokens: 2_001,
			metadata: {
				additional_usage_values: {
					cache_read_input_tokens: 200_001,
				},
			},
		});

		for (const testId of ["cache-tokens-progress", "input-tokens-progress", "output-tokens-progress"]) {
			expect(screen.getByTestId(testId)).toHaveStyle({ clipPath: "inset(0 0% 0 0)" });
		}
	});

	it.each([0, 19, Number.NaN])(
		"leaves output TPS blank when output tokens are below the meaningful threshold (%s)",
		(tokens) => {
			const { container } = renderColumnCell("输出 TPS", {
				...baseLogEntry,
				completion_tokens: tokens,
				startTime: "2025-11-14T00:00:00Z",
				endTime: "2025-11-14T00:00:02Z",
			});

			expect(container).toBeEmptyDOMElement();
		},
	);

	it("shows output TPS starting at 20 output tokens", () => {
		renderColumnCell("输出 TPS", {
			...baseLogEntry,
			completion_tokens: 20,
			startTime: "2025-11-14T00:00:00Z",
			endTime: "2025-11-14T00:00:02Z",
		});

		expect(screen.getByText("10.0")).toBeInTheDocument();
		expect(screen.getByLabelText("Output TPS 10.0")).toBeInTheDocument();
		expect(screen.getByTestId("output-tps-progress")).toHaveStyle({ clipPath: "inset(0 90% 0 0)" });
		expect(screen.getByTestId("output-tps-progress")).toHaveClass(
			"inset-0",
			"bg-gradient-to-r",
			"from-transparent",
			"via-blue-400/15",
			"to-blue-500/30",
		);
	});

	it("caps the output TPS progress bar at 100 TPS", () => {
		renderColumnCell("输出 TPS", {
			...baseLogEntry,
			completion_tokens: 250,
			startTime: "2025-11-14T00:00:00Z",
			endTime: "2025-11-14T00:00:02Z",
		});

		expect(screen.getByText("125.0")).toBeInTheDocument();
		expect(screen.getByTestId("output-tps-progress")).toHaveStyle({ clipPath: "inset(0 0% 0 0)" });
	});

	it("shows duration on a fixed red 30-second gradient scale", () => {
		renderColumnCell("Duration (s)", {
			...baseLogEntry,
			request_duration_ms: 3000,
		});

		expect(screen.getByText("3.00")).toBeInTheDocument();
		expect(screen.getByLabelText("Duration 3.00 seconds")).toBeInTheDocument();
		expect(screen.getByTestId("duration-progress")).toHaveStyle({ clipPath: "inset(0 90% 0 0)" });
		expect(screen.getByTestId("duration-progress")).toHaveClass(
			"inset-0",
			"bg-gradient-to-r",
			"from-transparent",
			"via-red-400/15",
			"to-red-500/30",
		);
	});

	it("caps the duration progress bar at 30 seconds", () => {
		renderColumnCell("Duration (s)", {
			...baseLogEntry,
			request_duration_ms: 45000,
		});

		expect(screen.getByText("45.00")).toBeInTheDocument();
		expect(screen.getByTestId("duration-progress")).toHaveStyle({ clipPath: "inset(0 0% 0 0)" });
	});
});

describe("SpendLogsTable", () => {
	const defaultProps = {
		accessToken: "test-token",
		token: "test-token",
		userRole: "Admin",
		userID: "user-1",
		allTeams: [] as Team[],
		premiumUser: false,
	};

	beforeEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
		mockFilters = {};
		mockFilteredLogs = { data: [], total: 0, page: 1, page_size: 50, total_pages: 1 };
		mockHasBackendFilters = false;
		mockDrawerProps.current = null;
		mockSimulationDrawerProps.current = null;
		// Clear persisted Live Tail state from previous tests.
		sessionStorage.clear();
		window.history.replaceState({}, "", "/ui/?page=logs");
	});

	it("Live Tail 默认每 2 秒刷新，并提供全部刷新间隔", async () => {
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		const intervalSelect = await screen.findByLabelText("Live Tail refresh interval");
		expect(intervalSelect).toHaveValue("2000");
		expect(Array.from((intervalSelect as HTMLSelectElement).options).map((option) => option.text)).toEqual([
			"关",
			"2s",
			"10s",
			"30s",
			"1m",
			"5m",
		]);
		expect(screen.getByText("Auto-refreshing every 2s")).toBeInTheDocument();
		await waitFor(() => expect(sessionStorage.getItem("liveTailIntervalMs")).toBe("2000"));
	});

	it("Live Tail 可以切换刷新间隔或关闭", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		const intervalSelect = await screen.findByLabelText("Live Tail refresh interval");
		await user.selectOptions(intervalSelect, "10000");
		expect(intervalSelect).toHaveValue("10000");
		expect(screen.getByText("Auto-refreshing every 10s")).toBeInTheDocument();
		await waitFor(() => expect(sessionStorage.getItem("liveTailIntervalMs")).toBe("10000"));

		await user.selectOptions(intervalSelect, "0");
		expect(intervalSelect).toHaveValue("0");
		expect(screen.queryByText(/Auto-refreshing every/)).not.toBeInTheDocument();
		await waitFor(() => expect(sessionStorage.getItem("liveTailIntervalMs")).toBe("0"));
	});

	it("旧 Live Tail 关闭状态会迁移为新的关闭间隔", async () => {
		sessionStorage.setItem("isLiveTail", "false");
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		expect(await screen.findByLabelText("Live Tail refresh interval")).toHaveValue("0");
		await waitFor(() => {
			expect(sessionStorage.getItem("liveTailIntervalMs")).toBe("0");
			expect(sessionStorage.getItem("isLiveTail")).toBeNull();
		});
	});

	it("相同 Claude Code group 的每条请求都显示，点击后向 Drawer 传完整 group", async () => {
		const user = userEvent.setup();
		const groupId = "user_device_account__session_123e4567-e89b-12d3-a456-426614174000";
		mockFilteredLogs = {
			data: [
				{
					...baseLogEntry,
					request_id: "req-mcp",
					call_type: "call_mcp_tool",
					session_id: "random-1",
					session_group_type: "claude_code_user_id",
					session_group_id: groupId,
					session_total_count: 2,
				},
				{
					...baseLogEntry,
					request_id: "req-llm",
					session_id: "random-2",
					session_group_type: "claude_code_user_id",
					session_group_id: groupId,
					session_total_count: 2,
				},
			],
			total: 2,
			page: 1,
			page_size: 50,
			total_pages: 1,
		};

		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		expect(await screen.findByText("req-mcp")).toBeInTheDocument();
		expect(await screen.findByText("req-llm")).toBeInTheDocument();
		await user.click(await screen.findByText("req-llm"));
		expect(mockDrawerProps.current.sessionGroup).toEqual({ type: "claude_code_user_id", id: groupId });
	});

	it("点击 Session ID 链接直接打开模拟窗口，不打开普通详情 Drawer", async () => {
		const user = userEvent.setup();
		const groupId = "user_device_account__session_123e4567-e89b-12d3-a456-426614174000";
		mockFilteredLogs = {
			data: [
				{
					...baseLogEntry,
					request_id: "req-session-link",
					session_id: "random-session",
					session_group_type: "claude_code_user_id",
					session_group_id: groupId,
				},
			],
			total: 1,
			page: 1,
			page_size: 50,
			total_pages: 1,
		};

		renderWithProviders(<SpendLogsTable {...defaultProps} />);
		await user.click(await screen.findByRole("link", { name: groupId }));

		expect(mockSimulationDrawerProps.current.sessionGroup).toEqual({
			type: "claude_code_user_id",
			id: groupId,
		});
		expect(screen.getByTestId("session-simulation-drawer")).toBeInTheDocument();
		expect(screen.queryByTestId("log-details-drawer")).not.toBeInTheDocument();
	});

	it("点击模拟时间线的 Log ID 后关闭模拟窗口并打开对应 Log 详情", async () => {
		const user = userEvent.setup();
		const groupId = "user_device_account__session_123e4567-e89b-12d3-a456-426614174000";
		mockFilteredLogs = {
			data: [
				{
					...baseLogEntry,
					request_id: "req-session-link",
					session_group_type: "claude_code_user_id",
					session_group_id: groupId,
				},
			],
			total: 1,
			page: 1,
			page_size: 50,
			total_pages: 1,
		};

		renderWithProviders(<SpendLogsTable {...defaultProps} />);
		await user.click(await screen.findByRole("link", { name: groupId }));
		await user.click(screen.getByRole("button", { name: "打开模拟日志" }));

		expect(screen.queryByTestId("session-simulation-drawer")).not.toBeInTheDocument();
		expect(screen.getByTestId("log-details-drawer")).toBeInTheDocument();
		expect(mockDrawerProps.current.logEntry.request_id).toBe("req-from-simulation");
		expect(mockDrawerProps.current.sessionGroup).toEqual({ type: "claude_code_user_id", id: groupId });
	});

	it("即使 session_total_count 为 1，点击带 session 的日志仍以 Session 模式打开 Drawer", async () => {
		const user = userEvent.setup();
		mockFilteredLogs = {
			data: [
				{
					...baseLogEntry,
					request_id: "req-single-session",
					session_id: "session-single",
					session_total_count: 1,
				},
			],
			total: 1,
			page: 1,
			page_size: 50,
			total_pages: 1,
		};

		renderWithProviders(<SpendLogsTable {...defaultProps} />);
		await user.click(await screen.findByText("req-single-session"));

		expect(mockDrawerProps.current.sessionGroup).toEqual({ type: "session_id", id: "session-single" });
	});

	it("进行中的日志不可打开尚不存在的详情 Drawer", async () => {
		const user = userEvent.setup();
		mockFilteredLogs = {
			data: [
				{
					...baseLogEntry,
					request_id: "req-active",
					status: "in_progress",
					metadata: { status: "in_progress" },
					session_id: undefined,
				},
			],
			total: 1,
			page: 1,
			page_size: 50,
			total_pages: 1,
		};

		renderWithProviders(<SpendLogsTable {...defaultProps} />);
		await user.click(await screen.findByText("req-active"));

		expect(screen.queryByTestId("log-details-drawer")).not.toBeInTheDocument();
		expect(mockDrawerProps.current.open).toBe(false);
	});

	it("Session Drawer 使用当前显式 Team ID filter scope，而非行自身 team_id", async () => {
		const user = userEvent.setup();
		mockFilters = { "Team ID": "scope-team" };
		mockFilteredLogs = {
			data: [
				{
					...baseLogEntry,
					request_id: "req-scoped-session",
					team_id: "row-team",
					session_id: "session-scoped",
					session_total_count: 2,
				},
			],
			total: 1,
			page: 1,
			page_size: 50,
			total_pages: 1,
		};

		renderWithProviders(<SpendLogsTable {...defaultProps} />);
		await user.click(await screen.findByText("req-scoped-session"));

		await waitFor(() => expect(mockDrawerProps.current.teamId).toBe("scope-team"));
		expect(mockDrawerProps.current.teamId).not.toBe("row-team");
	});

	it("should call handleFilterResetFromHook when Reset Filters is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		const resetButton = screen.getByRole("button", { name: "Reset Filters" });
		await user.click(resetButton);

		await waitFor(() => {
			expect(mockHandleFilterResetFromHook).toHaveBeenCalledTimes(1);
		});
	});

	it("should reset custom date range to default when Reset Filters is clicked", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		// Open the time range quick select dropdown (button shows current range like "Last 24 Hours")
		const quickSelectButton = screen.getByRole("button", {
			name: /Last 24 Hours|Last 15 Minutes|Last Hour|Last 4 Hours|Last 7 Days/i,
		});
		await user.click(quickSelectButton);

		// Click "Custom Range" to enable custom date selection
		const customRangeButton = await screen.findByRole("button", { name: "Custom Range" });
		await user.click(customRangeButton);

		// Custom date inputs should now be visible (start and end datetime-local inputs)
		const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]');
		expect(datetimeInputs.length).toBeGreaterThanOrEqual(2);

		// Click Reset Filters - this should reset the custom date range and hide custom inputs
		const resetButton = screen.getByRole("button", { name: "Reset Filters" });
		await user.click(resetButton);

		await waitFor(() => {
			expect(mockHandleFilterResetFromHook).toHaveBeenCalled();
		});

		// After reset, custom date inputs should be hidden (isCustomDate reset to false)
		await waitFor(() => {
			const inputsAfterReset = document.querySelectorAll('input[type="datetime-local"]');
			expect(inputsAfterReset.length).toBe(0);
		});
	});

	it("Fetch refreshes the backend-filtered data source when backend filters are active", async () => {
		const user = userEvent.setup();
		mockHasBackendFilters = true;
		mockFilters = { "Key Alias": "active-alias" };
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		await user.click(screen.getByTitle("Fetch data"));

		await waitFor(() => expect(mockRefetchFilteredLogs).toHaveBeenCalledTimes(1));
	});

	it("Live Tail continues refreshing the backend-filtered data source", async () => {
		vi.useFakeTimers();
		mockHasBackendFilters = true;
		mockFilters = { "Key Alias": "active-alias" };
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		expect(screen.getByText("Auto-refreshing every 2s")).toBeInTheDocument();
		await act(async () => {
			vi.advanceTimersByTime(2_000);
			await Promise.resolve();
		});

		expect(mockRefetchFilteredLogs).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("restores URL filters and view state when the page is refreshed", () => {
		window.history.replaceState(
			{},
			"",
			"/ui/?page=logs&key_alias=restored-alias&status_filter=failure&logs_page=3&logs_page_size=500&logs_sort_by=spend&logs_sort_order=asc",
		);

		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		expect(vi.mocked(useLogFilterLogic)).toHaveBeenCalledWith(
			expect.objectContaining({
				currentPage: 3,
				pageSize: 500,
				sortBy: "spend",
				sortOrder: "asc",
				initialFilters: expect.objectContaining({
					"Key Alias": "restored-alias",
					Status: "failure",
				}),
			}),
		);
		expect(screen.getByRole("combobox", { name: "Logs per page" })).toHaveValue("500");
	});

	it("canonicalizes the Logs URL by removing parameters owned by another page", async () => {
		mockFilters = { "Key Alias": "restored-alias" };
		window.history.replaceState(
			{},
			"",
			"/ui/?page=logs&tab=aliases&key_alias=restored-alias&logs_page=3&unrelated=stale",
		);

		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		await waitFor(() => {
			const params = new URLSearchParams(window.location.search);
			expect(params.get("page")).toBe("logs");
			expect(params.get("key_alias")).toBe("restored-alias");
			expect(params.get("logs_page")).toBe("3");
			expect(params.has("tab")).toBe(false);
			expect(params.has("unrelated")).toBe(false);
		});
	});

	it("offers supported page sizes and resets to page 1 when the size changes", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		const pageSizeSelect = screen.getByRole("combobox", { name: "Logs per page" });
		expect(Array.from(pageSizeSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
			"100",
			"200",
			"500",
			"1000",
		]);
		expect(pageSizeSelect).toHaveValue("100");
		expect(pageSizeSelect).toHaveClass("w-24", "min-w-24", "pl-3", "pr-8");
		expect(screen.getByTestId("logs-controls-row")).toHaveClass("xl:flex-row", "xl:items-center", "xl:justify-between");
		const fetchButton = screen.getByTitle("Fetch data");
		await waitFor(() => expect(fetchButton).toBeEnabled());
		await user.click(fetchButton);
		await waitFor(() => {
			expect(uiSpendLogsCall).toHaveBeenCalledWith(expect.objectContaining({ page: 1, page_size: 100 }));
		});
		await user.selectOptions(pageSizeSelect, "500");

		await waitFor(() => {
			expect(uiSpendLogsCall).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 500 }));
		});
	});
});
