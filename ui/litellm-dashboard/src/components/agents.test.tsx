/* @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AgentsPanel from "./agents";
import * as networking from "./networking";

vi.mock("./networking", () => ({
	getAgentsList: vi.fn().mockResolvedValue({
		agents: [{ agent_id: "agent-1", agent_name: "Example agent", spend: 0 }],
	}),
	deleteAgentCall: vi.fn().mockResolvedValue(undefined),
	keyListCall: vi.fn().mockResolvedValue({ keys: [] }),
}));

vi.mock("./agents/add_agent_form", () => ({
	default: () => <div data-testid="add-agent-form" />,
}));

vi.mock("./agents/agent_info", () => ({
	default: ({ onClose, onDelete }: { onClose: () => void; onDelete: (id: string, name: string) => void }) => (
		<div data-testid="agent-info">
			<button type="button" onClick={onClose}>
				Close agent drawer
			</button>
			<button type="button" onClick={() => onDelete("agent-1", "Example agent")}>
				Delete selected agent
			</button>
		</div>
	),
}));

describe("AgentsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should render the Agents panel title", () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);
		expect(screen.getByText("Agents")).toBeInTheDocument();
	});

	it("should show Add New Agent button for admin users", () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);
		expect(screen.getByText("+ Add New Agent")).toBeInTheDocument();
	});

	it("should show Add New Agent button for proxy_admin users", () => {
		render(<AgentsPanel accessToken="test-token" userRole="proxy_admin" />);
		expect(screen.getByText("+ Add New Agent")).toBeInTheDocument();
	});

	it("should not show Add New Agent button for internal_user role", () => {
		render(<AgentsPanel accessToken="test-token" userRole="Internal User" />);
		expect(screen.queryByText("+ Add New Agent")).not.toBeInTheDocument();
	});

	it("should not show Add New Agent button for internal_user_viewer role", () => {
		render(<AgentsPanel accessToken="test-token" userRole="Internal Viewer" />);
		expect(screen.queryByText("+ Add New Agent")).not.toBeInTheDocument();
	});

	it("should show Actions column header for admin role", async () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);
		await waitFor(() => {
			expect(screen.getByRole("columnheader", { name: /actions/i })).toBeInTheDocument();
		});
	});

	it("should not show Actions column header for internal user role", async () => {
		render(<AgentsPanel accessToken="test-token" userRole="Internal User" />);
		await waitFor(() => {
			expect(screen.queryByRole("columnheader", { name: /actions/i })).not.toBeInTheDocument();
			expect(screen.getByRole("table")).toBeInTheDocument();
		});
	});

	it("should render the Health Check toggle", () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);
		expect(screen.getByText("Health Check")).toBeInTheDocument();
	});

	it("should render the Health Check toggle for non-admin users too", () => {
		render(<AgentsPanel accessToken="test-token" userRole="Internal User" />);
		expect(screen.getByText("Health Check")).toBeInTheDocument();
	});

	it("should call getAgentsList with health_check=false on initial load", async () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);
		await waitFor(() => {
			expect(networking.getAgentsList).toHaveBeenCalledWith("test-token", false);
		});
	});

	it("should call getAgentsList with health_check=true when toggle is enabled", async () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);
		await waitFor(() => {
			expect(networking.getAgentsList).toHaveBeenCalledWith("test-token", false);
		});

		await act(async () => {
			fireEvent.click(screen.getByRole("switch"));
		});

		await waitFor(() => {
			expect(networking.getAgentsList).toHaveBeenCalledWith("test-token", true);
		});
	});

	it("keeps the list visible while the selected agent drawer is open", async () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);

		await waitFor(() => expect(screen.getByText("Example agent")).toBeInTheDocument());
		fireEvent.click(screen.getByText("agent-1..."));

		expect(screen.getByTestId("agent-info")).toBeInTheDocument();
		expect(screen.getByRole("table")).toBeInTheDocument();
	});

	it("closes the selected agent drawer after deletion succeeds", async () => {
		render(<AgentsPanel accessToken="test-token" userRole="Admin" />);

		await waitFor(() => expect(screen.getByText("Example agent")).toBeInTheDocument());
		fireEvent.click(screen.getByText("agent-1..."));
		fireEvent.click(screen.getByRole("button", { name: "Delete selected agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => {
			expect(networking.deleteAgentCall).toHaveBeenCalledWith("test-token", "agent-1");
			expect(screen.queryByTestId("agent-info")).not.toBeInTheDocument();
		});
	});
});
