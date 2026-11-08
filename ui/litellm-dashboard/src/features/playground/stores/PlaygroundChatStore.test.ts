import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaygroundChatStore } from "./PlaygroundChatStore";
import type { PlaygroundCallbacks, PlaygroundRequest } from "../support/PlaygroundModels";
import type { PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
const storage = (): PlaygroundStorage => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
afterEach(() => vi.unstubAllGlobals());
describe("Playground request lifecycle", () => {
	it("aborts an active request and prevents late chunks from crossing into a cleared conversation", async () => {
		vi.stubGlobal("window", { dispatchEvent: vi.fn() });
		let callbacks: PlaygroundCallbacks | undefined,
			request: PlaygroundRequest | undefined,
			finish: () => void = () => {};
		const send = vi.fn((value: PlaygroundRequest, hooks: PlaygroundCallbacks) => {
				request = value;
				callbacks = hooks;
				return new Promise<void>((resolve) => (finish = resolve));
			}),
			store = createPlaygroundChatStore({ storage: storage(), send });
		store.settings.state.selectedModel = "fixture";
		store.state.input = "First prompt";
		const pending = store.send();
		expect(store.state.loading).toBe(true);
		callbacks?.text("Partial");
		store.clear();
		expect(request?.signal?.aborted).toBe(true);
		callbacks?.text("Late data");
		finish();
		await pending;
		expect(store.history.state.messages).toEqual([]);
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
	it("continues Responses with only the new message and resets the server session when UI mode is selected", async () => {
		vi.stubGlobal("window", { dispatchEvent: vi.fn() });
		const sent: PlaygroundRequest[] = [],
			send = vi.fn(async (request: PlaygroundRequest, hooks: PlaygroundCallbacks) => {
				sent.push(request);
				hooks.text("Answer");
				hooks.responseId?.("response-" + sent.length);
			}),
			store = createPlaygroundChatStore({ storage: storage(), send });
		store.settings.selectEndpoint("responses");
		store.settings.state.selectedModel = "fixture";
		store.state.input = "One";
		await store.send();
		store.state.input = "Two";
		await store.send();
		expect(sent[1].previousResponseId).toBe("response-1");
		expect(sent[1].messages).toEqual([{ role: "user", content: "Two" }]);
		store.history.toggleSession(false);
		store.state.input = "Three";
		await store.send();
		expect(sent[2].previousResponseId).toBeNull();
		expect(sent[2].messages).toHaveLength(5);
		store.dispose();
	});
});
