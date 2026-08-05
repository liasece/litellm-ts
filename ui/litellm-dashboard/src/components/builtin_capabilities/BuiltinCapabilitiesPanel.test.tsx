import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BuiltinCapabilitiesPanel from "./BuiltinCapabilitiesPanel";

const mocks = vi.hoisted(() => ({
	load: vi.fn(),
	update: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));

vi.mock("../networking", () => ({
	builtinCapabilitiesCall: mocks.load,
	updateBuiltinCapabilitiesCall: mocks.update,
}));

vi.mock("../molecules/notifications_manager", () => ({
	default: {
		success: mocks.success,
		fromBackend: mocks.error,
	},
}));

const response = {
	capabilities: {
		vision: {
			enabled: true,
			always_inject: false,
			handler_model: "gpt-5.4-mini",
			fallback_models: ["gpt-5.4"],
			max_iterations: 4,
			max_output_tokens: 2048,
		},
	},
	available_models: [
		{ model_name: "gpt-5.4-mini", type: "model", mode: "chat" },
		{ model_name: "gpt-5.4", type: "model", mode: "chat" },
	],
};

describe("BuiltinCapabilitiesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.load.mockResolvedValue(response);
		mocks.update.mockResolvedValue(response);
	});

	it("loads persisted capability settings and saves the independent fallback chain", async () => {
		render(<BuiltinCapabilitiesPanel />);

		expect(await screen.findByText("Vision")).toBeInTheDocument();
		expect(screen.getByText(/injection requires this global switch and vision on the requested model/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				vision: {
					enabled: true,
					always_inject: false,
					handler_model: "gpt-5.4-mini",
					fallback_models: ["gpt-5.4"],
					max_iterations: 4,
					max_output_tokens: 2048,
				},
			}),
		);
		expect(mocks.success).toHaveBeenCalledWith("Built-in capabilities updated");
	});

	it("allows administrators to enable unconditional context injection", async () => {
		render(<BuiltinCapabilitiesPanel />);

		const alwaysInject = await screen.findByRole("switch", { name: "Always inject into context" });
		expect(alwaysInject).not.toBeChecked();
		fireEvent.click(alwaysInject);
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				vision: expect.objectContaining({ always_inject: true }),
			}),
		);
	});
});
