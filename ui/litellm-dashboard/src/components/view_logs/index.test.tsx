import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpendLogsTable, { RequestViewer } from "./index";
import { createColumns, getSessionGroupKey, getSessionGroupRef, type LogEntry } from "./columns";
import { uiSpendLogsCall } from "../networking";
import type { Row } from "@tanstack/react-table";
import type { Team } from "../key_team_helpers/key_list";
import { renderWithProviders } from "../../../tests/test-utils";

const mockHandleFilterResetFromHook = vi.fn();
let mockFilters: Record<string, string> = {};
let mockFilteredLogs = { data: [] as LogEntry[], total: 0, page: 1, page_size: 50, total_pages: 1 };
vi.mock("./log_filter_logic", () => ({
	useLogFilterLogic: vi.fn(() => ({
		filters: mockFilters,
		filteredLogs: mockFilteredLogs,
		allTeams: [],
		handleFilterChange: vi.fn(),
		handleFilterReset: mockHandleFilterResetFromHook,
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

const mockDrawerProps = vi.hoisted(() => ({ current: null as any }));
vi.mock("./LogDetailsDrawer", () => ({
	LogDetailsDrawer: (props: any) => {
		mockDrawerProps.current = props;
		return props.open ? <div data-testid="log-details-drawer" /> : null;
	},
}));

vi.mock("./table", () => ({
	DataTable: ({ data, onRowClick }: { data: LogEntry[]; onRowClick?: (log: LogEntry) => void }) => (
		<div>
			{data.map((log) => (
				<button key={log.request_id} onClick={() => onRowClick?.(log)}>
					{log.request_id}
				</button>
			))}
		</div>
	),
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

	it("does not expose Session ID as a table column", () => {
		const columns = createColumns();
		expect(columns.some((column) => column.header === "Session ID")).toBe(false);
	});

	const renderColumnCell = (header: string, entry: LogEntry) => {
		const column = createColumns().find((candidate) => candidate.header === header);
		if (!column || typeof column.cell !== "function") {
			throw new Error(`Missing ${header} cell renderer`);
		}

		return render(
			column.cell({
				getValue: () => (header === "Model" ? entry.model : entry.total_tokens),
				row: { original: entry },
			} as never),
		);
	};

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
		expect(await screen.findByText("OpenAI/gpt-4o")).toBeInTheDocument();
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
		expect(await screen.findByText(/Request: alias-a → alias-b → model-a/)).toBeInTheDocument();
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
		expect(tokenSummary).toHaveClass("inline-grid", "min-w-56", "grid-cols-3", "text-left", "text-current");
		expect(screen.queryByText("120")).not.toBeInTheDocument();
		expect(screen.queryByText(/Input:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Cache read:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Cache creation:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Output:/)).not.toBeInTheDocument();

		const tokenColumns = screen.getAllByTestId("token-column");
		expect(tokenColumns).toHaveLength(3);
		for (const column of tokenColumns) {
			expect(column).toHaveClass("flex", "min-w-16", "items-center", "text-left");
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
		vi.clearAllMocks();
		mockFilters = {};
		mockFilteredLogs = { data: [], total: 0, page: 1, page_size: 50, total_pages: 1 };
		mockDrawerProps.current = null;
		// Clear sessionStorage to avoid isLiveTail state from previous tests
		sessionStorage.clear();
	});

	it("相同 Claude Code group 按 type + id 去重并向 Drawer 传完整 group", async () => {
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

		expect(screen.queryByText("req-mcp")).not.toBeInTheDocument();
		await user.click(await screen.findByText("req-llm"));
		expect(mockDrawerProps.current.sessionGroup).toEqual({ type: "claude_code_user_id", id: groupId });
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

	it("offers supported page sizes and resets to page 1 when the size changes", async () => {
		const user = userEvent.setup();
		renderWithProviders(<SpendLogsTable {...defaultProps} />);

		const pageSizeSelect = screen.getByRole("combobox", { name: "Logs per page" });
		expect(Array.from(pageSizeSelect.querySelectorAll("option"))).toHaveLength(5);
		expect(pageSizeSelect).toHaveValue("50");
		await user.selectOptions(pageSizeSelect, "500");

		await waitFor(() => {
			expect(uiSpendLogsCall).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, page_size: 500 }));
		});
	});
});
