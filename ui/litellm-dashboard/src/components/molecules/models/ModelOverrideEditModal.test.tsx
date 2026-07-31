import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { modelPatchUpdateCall } from "@/components/networking";
import ModelOverrideEditModal from "./ModelOverrideEditModal";

vi.mock("@/components/networking", () => ({
	modelPatchUpdateCall: vi.fn(),
}));

vi.mock("@/components/molecules/notifications_manager", () => ({
	default: {
		success: vi.fn(),
		fromBackend: vi.fn(),
	},
}));

const mockModelPatchUpdateCall = vi.mocked(modelPatchUpdateCall);
const mockNotificationsManager = vi.mocked(NotificationsManager);

describe("ModelOverrideEditModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockModelPatchUpdateCall.mockResolvedValue({});
	});

	it("quickly saves the selected target as override_model_name", async () => {
		const onSuccess = vi.fn();
		render(
			<ModelOverrideEditModal
				isOpen
				modelId="source-id"
				modelName="source-model"
				currentOverride={null}
				availableModels={["source-model", "target-model"]}
				accessToken="token"
				onCancel={vi.fn()}
				onSuccess={onSuccess}
			/>,
		);

		fireEvent.mouseDown(screen.getByRole("combobox", { name: "Override Target" }));
		const targetOptions = await screen.findAllByText("target-model");
		fireEvent.click(targetOptions[targetOptions.length - 1]);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(mockModelPatchUpdateCall).toHaveBeenCalledWith(
				"token",
				{ model_info: { override_model_name: "target-model" } },
				"source-id",
			),
		);
		expect(mockNotificationsManager.success).toHaveBeenCalledWith("Model override set to target-model");
		expect(onSuccess).toHaveBeenCalled();
	});
});
