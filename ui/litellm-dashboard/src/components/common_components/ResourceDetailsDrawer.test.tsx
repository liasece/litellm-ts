/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResourceDetailsDrawer from "./ResourceDetailsDrawer";

describe("ResourceDetailsDrawer", () => {
	it("renders title actions and closes through the Drawer", () => {
		const onClose = vi.fn();
		render(
			<ResourceDetailsDrawer
				open
				onClose={onClose}
				title="Model details"
				subtitle="deployment-1"
				actions={<button type="button">Edit</button>}
			>
				<div>Details content</div>
			</ResourceDetailsDrawer>,
		);

		expect(screen.getByText("Model details")).toBeInTheDocument();
		expect(screen.getByText("deployment-1")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("renders error recovery in the Drawer content", () => {
		const onRetry = vi.fn();
		render(
			<ResourceDetailsDrawer open onClose={vi.fn()} title="Model details" error="Unable to load" onRetry={onRetry}>
				<div>Details content</div>
			</ResourceDetailsDrawer>,
		);

		expect(screen.getByText("Unable to load")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
