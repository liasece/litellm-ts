import { act, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../../tests/test-utils";
import UsageAIChatPanel from "./UsageAIChatPanel";

beforeAll(() => {
	if (typeof window !== "undefined" && !window.ResizeObserver) {
		window.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as any;
	}
});

vi.mock("../../networking", () => ({
	modelHubCall: vi.fn().mockResolvedValue({
		data: [{ model_group: "gpt-4" }, { model_group: "claude-3-opus" }],
	}),
	usageAiChatStream: vi.fn(),
}));

const defaultProps = {
	open: true,
	onClose: vi.fn(),
	accessToken: "test-token",
};

const renderPanel = async (props = defaultProps) => {
	await act(async () => {
		renderWithProviders(<UsageAIChatPanel {...props} />);
	});
};

describe("UsageAIChatPanel", () => {
	it("should render the panel when open", async () => {
		await renderPanel();

		expect(screen.getByText("Ask AI")).toBeInTheDocument();
		expect(screen.getByText("Ask about your spend, models, keys, and trends")).toBeInTheDocument();
	});

	it("should render model selector", async () => {
		await renderPanel();

		expect(screen.getByText("Select a model (optional, defaults to gpt-4o-mini)")).toBeInTheDocument();
	});

	it("should render empty state message when no conversation", async () => {
		await renderPanel();

		expect(screen.getByText("Ask a question about your usage")).toBeInTheDocument();
	});

	it("should render the send button", async () => {
		await renderPanel();

		expect(screen.getByText("Send")).toBeInTheDocument();
	});

	it("should render input placeholder", async () => {
		await renderPanel();

		expect(screen.getByPlaceholderText("Ask about your usage...")).toBeInTheDocument();
	});

	it("should render clear chat button", async () => {
		await renderPanel();

		expect(screen.getByText("Clear chat")).toBeInTheDocument();
	});

	it("should have the panel element even when closed (just off-screen)", async () => {
		await renderPanel({ ...defaultProps, open: false });

		expect(screen.getByTestId("usage-ai-chat-panel")).toBeInTheDocument();
		expect(screen.getByTestId("usage-ai-chat-panel")).toHaveClass("translate-x-full");
	});

	it("should not have translate-x-full class when open", async () => {
		await renderPanel({ ...defaultProps, open: true });

		expect(screen.getByTestId("usage-ai-chat-panel")).not.toHaveClass("translate-x-full");
		expect(screen.getByTestId("usage-ai-chat-panel")).toHaveClass("translate-x-0");
	});
});
