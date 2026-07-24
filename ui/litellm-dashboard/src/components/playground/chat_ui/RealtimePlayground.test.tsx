import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RealtimePlayground from "./RealtimePlayground";

vi.mock("../../networking", () => ({
	getProxyBaseUrl: vi.fn(() => "http://proxy.example"),
}));

const webSocket = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	webSocket.mockImplementation(() => ({ close: vi.fn() }));
	Element.prototype.scrollIntoView = vi.fn();
	Object.defineProperty(globalThis, "AudioContext", {
		configurable: true,
		value: vi.fn(() => ({ close: vi.fn() })),
	});
	Object.defineProperty(globalThis, "WebSocket", {
		configurable: true,
		value: webSocket,
	});
});

describe("RealtimePlayground", () => {
	it("uses only the realtime protocol for session auth", () => {
		render(<RealtimePlayground auth={{ kind: "session" }} selectedModel="gpt-realtime" />);
		fireEvent.click(screen.getByRole("button", { name: "Connect" }));

		expect(webSocket).toHaveBeenCalledWith("ws://proxy.example/v1/realtime?model=gpt-realtime", ["realtime"]);
	});

	it("adds the virtual key WebSocket protocol for virtual-key auth", () => {
		render(<RealtimePlayground auth={{ kind: "virtual-key", apiKey: "virtual-key" }} selectedModel="gpt-realtime" />);
		fireEvent.click(screen.getByRole("button", { name: "Connect" }));

		expect(webSocket).toHaveBeenCalledWith("ws://proxy.example/v1/realtime?model=gpt-realtime", [
			"realtime",
			"openai-insecure-api-key.virtual-key",
		]);
	});
});
