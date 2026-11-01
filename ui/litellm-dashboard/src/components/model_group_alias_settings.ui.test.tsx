import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelGroupAliasSettings from "./model_group_alias_settings";

const mockRoutableModelOptionsCall = vi.fn();
const mockSetCallbacksCall = vi.fn();

vi.mock("./networking", () => ({
	routableModelOptionsCall: (...args: unknown[]) => mockRoutableModelOptionsCall(...args),
	latestHealthChecksCall: vi.fn().mockResolvedValue({ latest_health_checks: {} }),
	modelGroupHealthCheckCall: vi.fn(),
	setCallbacksCall: (...args: unknown[]) => mockSetCallbacksCall(...args),
}));

vi.mock("./molecules/notifications_manager", () => ({
	default: { error: vi.fn(), success: vi.fn() },
}));

const existingSchedule = {
	model: "model-a",
	hidden: true,
	timezone: "Asia/Shanghai",
	schedule: [{ start: "00:30", end: "08:30", model: "model-b" }],
};

async function selectTarget(label: string, value: string) {
	const user = userEvent.setup();
	const input = screen.getByRole("combobox", { name: label });
	await user.click(input);
	await user.type(input, value);
	const option = await waitFor(() => {
		const found = screen.getAllByTitle(value).find((element) => element.classList.contains("ant-select-item-option"));
		expect(found).toBeDefined();
		return found!;
	});
	await user.click(option);
}

describe("ModelGroupAliasSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSetCallbacksCall.mockResolvedValue({});
		mockRoutableModelOptionsCall.mockResolvedValue({
			data: [
				{ model_name: "model-a", type: "model", mode: "chat" },
				{ model_name: "model-b", type: "model", mode: "chat" },
				{ model_name: "existing-alias", type: "alias", mode: "chat" },
			],
		});
	});

	it("shows all routable models when editing an alias resolution", async () => {
		render(<ModelGroupAliasSettings accessToken="token" initialModelGroupAlias={{ "request-alias": "model-a" }} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit alias request-alias" }));
		await waitFor(() => expect(mockRoutableModelOptionsCall).toHaveBeenCalled());
		fireEvent.mouseDown(screen.getByRole("combobox", { name: "Resolution" }));
		expect((await screen.findAllByText("model-a")).length).toBeGreaterThan(0);
		expect(screen.getAllByText("model-b").length).toBeGreaterThan(0);
		expect(screen.getAllByText("existing-alias").length).toBeGreaterThan(0);
	});

	it("creates a scheduled alias from form fields without changing existing alias objects or arrays", async () => {
		const initial = { scheduled: existingSchedule, legacy: ["model-b", "model-a"] };
		render(<ModelGroupAliasSettings accessToken="token" initialModelGroupAlias={initial} />);
		fireEvent.click(screen.getByRole("button", { name: "Add Alias" }));
		fireEvent.change(screen.getByLabelText("Alias name"), { target: { value: "economy" } });
		await selectTarget("Resolution", "model-a");
		fireEvent.click(screen.getByRole("button", { name: "Add time window" }));
		expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Shanghai");
		fireEvent.change(screen.getByLabelText("Start time 1"), { target: { value: "22:00" } });
		fireEvent.change(screen.getByLabelText("End time 1"), { target: { value: "06:00" } });
		await selectTarget("Time window target 1", "model-b");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(mockSetCallbacksCall).toHaveBeenCalledWith("token", {
				router_settings: {
					model_group_alias: {
						...initial,
						economy: {
							model: "model-a",
							timezone: "Asia/Shanghai",
							schedule: [{ start: "22:00", end: "06:00", model: "model-b" }],
						},
					},
				},
			}),
		);
		expect(initial.scheduled).toEqual(existingSchedule);
		expect(await screen.findByText("22:00–06:00 (+1 day) → model-b")).toBeInTheDocument();
	});

	it("cancels edits without mutating the original schedule or persisting", async () => {
		render(<ModelGroupAliasSettings accessToken="token" initialModelGroupAlias={{ scheduled: existingSchedule }} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit alias scheduled" }));
		fireEvent.change(screen.getByLabelText("Start time 1"), { target: { value: "01:00" } });
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: "Edit alias scheduled" }));
		expect(screen.getByLabelText("Start time 1")).toHaveValue("00:30");
		expect(mockSetCallbacksCall).not.toHaveBeenCalled();
	});

	it("removes the last window and restores the all-day default while preserving hidden", async () => {
		render(<ModelGroupAliasSettings accessToken="token" initialModelGroupAlias={{ scheduled: existingSchedule }} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit alias scheduled" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove time window 1" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(mockSetCallbacksCall).toHaveBeenCalledWith("token", {
				router_settings: { model_group_alias: { scheduled: { model: "model-a", hidden: true } } },
			}),
		);
	});

	it("rejects overlapping windows before calling the backend", async () => {
		render(<ModelGroupAliasSettings accessToken="token" initialModelGroupAlias={{ scheduled: existingSchedule }} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit alias scheduled" }));
		fireEvent.click(screen.getByRole("button", { name: "Add time window" }));
		fireEvent.change(screen.getByLabelText("Start time 2"), { target: { value: "07:00" } });
		fireEvent.change(screen.getByLabelText("End time 2"), { target: { value: "09:00" } });
		await selectTarget("Time window target 2", "model-b");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("must not overlap");
		expect(mockSetCallbacksCall).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});

	it("keeps the saved configuration and editor when persistence fails", async () => {
		mockSetCallbacksCall.mockRejectedValue(new Error("Save failed"));
		render(<ModelGroupAliasSettings accessToken="token" initialModelGroupAlias={{ scheduled: existingSchedule }} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit alias scheduled" }));
		fireEvent.change(screen.getByLabelText("Start time 1"), { target: { value: "02:00" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
		expect(screen.getByText("00:30–08:30 → model-b")).toBeInTheDocument();
		expect(screen.getByLabelText("Start time 1")).toHaveValue("02:00");
	});

	it("preserves schedules when deleting a different alias", async () => {
		render(
			<ModelGroupAliasSettings
				accessToken="token"
				initialModelGroupAlias={{ scheduled: existingSchedule, remove: "model-a" }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Delete alias remove" }));
		await waitFor(() =>
			expect(mockSetCallbacksCall).toHaveBeenCalledWith("token", {
				router_settings: { model_group_alias: { scheduled: existingSchedule } },
			}),
		);
	});
});
