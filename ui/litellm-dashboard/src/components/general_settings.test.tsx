import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GeneralSettings from "./general_settings";
import {
	deleteConfigFieldSetting,
	getGeneralSettingsCall,
	getRoutableModelCandidatesCall,
	updateConfigFieldSetting,
} from "./networking";

vi.mock("./networking", () => ({
	getGeneralSettingsCall: vi.fn(),
	getRoutableModelCandidatesCall: vi.fn(),
	updateConfigFieldSetting: vi.fn(),
	deleteConfigFieldSetting: vi.fn(),
}));

vi.mock("./router_settings", () => ({ default: () => null }));
vi.mock("./Settings/RouterSettings/Fallbacks/Fallbacks", () => ({ default: () => null }));

describe("GeneralSettings web-search override", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getGeneralSettingsCall).mockResolvedValue([
			{
				field_name: "websearch_override_target_model",
				field_type: "String",
				field_value: "logical-model",
				field_description: "web search target",
				stored_in_db: false,
			},
			{
				field_name: "maximum_spend_logs_retention_period",
				field_type: "String",
				field_value: "30d",
				field_description: "other string",
				stored_in_db: false,
			},
		]);
		vi.mocked(getRoutableModelCandidatesCall).mockResolvedValue([
			{ model_name: "logical-model", type: "model" },
			{ model_name: "search-alias", type: "alias" },
		]);
	});

	it("将 web-search 覆盖渲染为可搜索单选下拉，其他 String 字段仍为输入框", async () => {
		render(<GeneralSettings accessToken="token" userRole="admin" userID="user" modelData={{}} />);

		fireEvent.click(screen.getByText("General"));
		const targetLabel = await screen.findByText("websearch_override_target_model");
		const targetRow = targetLabel.closest("tr")!;
		const otherRow = screen.getByText("maximum_spend_logs_retention_period").closest("tr")!;

		expect(within(targetRow).getByRole("combobox")).toBeInTheDocument();
		expect(within(targetRow).queryByRole("textbox")).toBeNull();
		expect(within(otherRow).getByRole("textbox")).toBeInTheDocument();

		fireEvent.mouseDown(within(targetRow).getByRole("combobox"));
		expect((await screen.findAllByText("模型: logical-model")).length).toBeGreaterThan(0);
		expect(screen.getByText("Alias: search-alias")).toBeInTheDocument();
		fireEvent.click(screen.getByText("Alias: search-alias"));
		fireEvent.click(within(targetRow).getByText("Update"));

		await waitFor(() => {
			expect(updateConfigFieldSetting).toHaveBeenCalledWith("token", "websearch_override_target_model", "search-alias");
		});
	});
});
