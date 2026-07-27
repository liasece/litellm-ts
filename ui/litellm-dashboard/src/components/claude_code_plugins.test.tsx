/* @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClaudeCodePluginsPanel from "./claude_code_plugins";
import * as networking from "./networking";

vi.mock("./networking", () => ({
	getClaudeCodePluginsList: vi.fn().mockResolvedValue({
		plugins: [{ id: "plugin-1", name: "example-plugin", enabled: true }],
	}),
	deleteClaudeCodePlugin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./claude_code_plugins/add_plugin_form", () => ({
	default: () => <div data-testid="add-plugin-form" />,
}));

vi.mock("./claude_code_plugins/plugin_table", () => ({
	default: ({ onPluginClick }: { onPluginClick: (id: string) => void }) => (
		<div data-testid="plugin-table">
			<button type="button" onClick={() => onPluginClick("example-plugin")}>
				Open plugin
			</button>
		</div>
	),
}));

vi.mock("./claude_code_plugins/plugin_info", () => ({
	default: ({ onDelete }: { onDelete: (name: string, displayName: string) => void }) => (
		<div data-testid="plugin-info">
			<button type="button" onClick={() => onDelete("example-plugin", "example-plugin")}>
				Delete selected plugin
			</button>
		</div>
	),
}));

describe("ClaudeCodePluginsPanel", () => {
	beforeEach(() => vi.clearAllMocks());

	it("keeps the plugin table visible while the selected plugin drawer is open", async () => {
		render(<ClaudeCodePluginsPanel accessToken="test-token" userRole="Admin" />);

		await waitFor(() => expect(screen.getByTestId("plugin-table")).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: "Open plugin" }));

		expect(screen.getByTestId("plugin-info")).toBeInTheDocument();
		expect(screen.getByTestId("plugin-table")).toBeInTheDocument();
	});

	it("closes the selected plugin drawer after deletion succeeds", async () => {
		render(<ClaudeCodePluginsPanel accessToken="test-token" userRole="Admin" />);

		await waitFor(() => expect(screen.getByTestId("plugin-table")).toBeInTheDocument());
		fireEvent.click(screen.getByRole("button", { name: "Open plugin" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete selected plugin" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => {
			expect(networking.deleteClaudeCodePlugin).toHaveBeenCalledWith("test-token", "example-plugin");
			expect(screen.queryByTestId("plugin-info")).not.toBeInTheDocument();
		});
	});
});
