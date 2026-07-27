import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentBuilderView from "./AgentBuilderView";
import { fetchAvailableAgentModels } from "../llm_calls/fetch_agents";
import { fetchRoutableModels } from "../llm_calls/fetch_models";
import { modelCreateCall } from "../../networking";

vi.mock("../llm_calls/fetch_models", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../llm_calls/fetch_models")>();
	return {
		...actual,
		fetchRoutableModels: vi.fn(),
	};
});

vi.mock("../llm_calls/fetch_agents", () => ({
	fetchAvailableAgentModels: vi.fn(),
}));

vi.mock("../../networking", () => ({
	fetchMCPServers: vi.fn().mockResolvedValue([]),
	keyCreateCall: vi.fn(),
	modelCreateCall: vi.fn().mockResolvedValue({}),
	modelDeleteCall: vi.fn(),
	modelPatchUpdateCall: vi.fn(),
	proxyBaseUrl: undefined,
}));

vi.mock("../complianceUI/ComplianceUI", () => ({ default: () => null }));
vi.mock("./ChatUI", () => ({ default: () => null }));
vi.mock("@/app/(dashboard)/api-reference/components/CodeBlock", () => ({ default: () => null }));

describe("AgentBuilderView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchAvailableAgentModels).mockResolvedValue([]);
		vi.mocked(fetchRoutableModels).mockResolvedValue([
			{ model_group: "z-model", type: "model" },
			{ model_group: "fast", type: "alias" },
		]);
	});

	it("labels alias options and saves the raw alias as the underlying model", async () => {
		const user = userEvent.setup();
		const { container } = render(
			<AgentBuilderView accessToken="access-token" token="token" userID="user-id" userRole="Admin" />,
		);

		await waitFor(() => expect(fetchRoutableModels).toHaveBeenCalledWith("access-token"));
		await user.click(await screen.findByRole("button", { name: /New agent/i }));

		const select = screen.getByText("Underlying LLM").parentElement?.querySelector(".ant-select-selector");
		fireEvent.mouseDown(select!);
		const optionContents = Array.from(document.querySelectorAll(".ant-select-item-option-content"));
		expect(optionContents.map((option) => option.textContent)).toEqual(["Alias: fast", "模型: z-model"]);

		await user.click(screen.getByText("Alias: fast"));
		await user.type(screen.getByPlaceholderText("My Agent"), "Alias Agent");
		await user.click(screen.getByRole("button", { name: /Save Agent/i }));

		await waitFor(() => {
			expect(modelCreateCall).toHaveBeenCalledWith(
				"access-token",
				expect.objectContaining({
					model_name: "Alias Agent",
					litellm_params: expect.objectContaining({ model: "litellm_agent/fast" }),
				}),
			);
		});
		expect(container).toBeInTheDocument();
	});
});
