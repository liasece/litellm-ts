import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelGroupAliasSettings from "./model_group_alias_settings";

const mockRoutableModelOptionsCall = vi.fn();

vi.mock("./networking", () => ({
	routableModelOptionsCall: (...args: unknown[]) => mockRoutableModelOptionsCall(...args),
	latestHealthChecksCall: vi.fn().mockResolvedValue({ latest_health_checks: {} }),
	modelGroupHealthCheckCall: vi.fn(),
	setCallbacksCall: vi.fn(),
}));

vi.mock("./molecules/notifications_manager", () => ({
	default: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe("ModelGroupAliasSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

		await waitFor(() => expect(screen.getByRole("button", { name: "Edit alias request-alias" })).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: "Edit alias request-alias" }));
		fireEvent.mouseDown(screen.getByRole("combobox", { name: "Resolution" }));

		expect((await screen.findAllByText("model-a")).length).toBeGreaterThan(0);
		expect(screen.getByText("model-b")).toBeInTheDocument();
		expect(screen.getByText("existing-alias")).toBeInTheDocument();
	});
});
