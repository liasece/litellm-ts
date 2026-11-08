import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createPlaygroundHistoryStore } from "./PlaygroundHistoryStore";
import type { PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
function memory() {
	const values = new Map<string, string>();
	const storage: PlaygroundStorage = {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
	return { values, storage };
}
afterEach(() => vi.useRealTimers());
describe("Playground conversation state", () => {
	it("restores the legacy storage shape, joins stream chunks and persists session ids", async () => {
		vi.useFakeTimers();
		const { values, storage } = memory();
		values.set("chatHistory", JSON.stringify([{ role: "user", content: "Before migration" }]));
		const store = createPlaygroundHistoryStore({ storage });
		store.callbacks.text("Hello", "fixture");
		store.callbacks.reasoning?.("Think");
		store.callbacks.text(" world", "another");
		store.callbacks.usage?.({ promptTokens: 3, completionTokens: 2, cost: 0 });
		store.callbacks.responseId?.("response-fixture");
		await nextTick();
		await vi.advanceTimersByTimeAsync(500);
		const saved = JSON.parse(values.get("chatHistory") ?? "[]");
		expect(saved[1]).toMatchObject({
			role: "assistant",
			content: "Hello world",
			model: "fixture",
			reasoningContent: "Think",
			usage: { cost: 0 },
		});
		expect(values.get("responsesSessionId")).toBe("response-fixture");
		store.toggleSession(false);
		await nextTick();
		expect(values.has("responsesSessionId")).toBe(false);
		store.dispose();
	});
	it("keeps simplified embedded conversations isolated and removes persisted history on clear", async () => {
		const { values, storage } = memory();
		values.set("chatHistory", JSON.stringify([{ role: "user", content: "Private prior thread" }]));
		const isolated = createPlaygroundHistoryStore({ storage, simplified: true });
		expect(isolated.state.messages).toEqual([]);
		isolated.append({ role: "user", content: "Isolated" });
		isolated.dispose();
		expect(JSON.parse(values.get("chatHistory") ?? "[]")[0].content).toBe("Private prior thread");
		const regular = createPlaygroundHistoryStore({ storage });
		regular.clear();
		await nextTick();
		expect(values.has("chatHistory")).toBe(false);
		regular.dispose();
	});
});
