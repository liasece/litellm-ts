import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { createChatHistoryStore } from "./ChatHistoryStore";
import type { PlaygroundStorage } from "../logic/PlaygroundStorageLogic";
import { redactChatToolArguments } from "../logic/ChatHistoryLogic";
function memory() {
	const values = new Map<string, string>(),
		storage: PlaygroundStorage = {
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
describe("independent chat persistence", () => {
	it("saves conversations in the original key and truncates edit history before resend", async () => {
		const { storage, values } = memory(),
			store = createChatHistoryStore(storage),
			id = store.create("fixture");
		store.append(id, { role: "user", content: "A long opening prompt that becomes the original conversation title" });
		store.append(id, { role: "assistant", content: "First answer" });
		store.append(id, { role: "user", content: "Edit this" });
		store.append(id, { role: "assistant", content: "Remove this" });
		const editId = store.active.value?.messages[2].id ?? "";
		store.truncate(id, editId);
		expect(store.active.value?.messages.map((message) => message.content)).toEqual([
			"A long opening prompt that becomes the original conversation title",
			"First answer",
		]);
		store.rename(id, "Renamed");
		await nextTick();
		const restored = createChatHistoryStore(storage);
		expect(values.has("litellm_chat_history_v1")).toBe(true);
		restored.select(id);
		expect(restored.active.value?.title).toBe("Renamed");
		store.dispose();
		restored.dispose();
	});
	it("reports storage failure and recursively redacts nested tool secrets", () => {
		const store = createChatHistoryStore({
			getItem: () => {
				throw new Error("Blocked");
			},
			setItem: () => {},
			removeItem: () => {},
		});
		expect(store.state.storageUnavailable).toBe(true);
		expect(redactChatToolArguments({ input: { api_key: "sensitive", safe: [{ authToken: "hidden", query: "visible" }] } })).toEqual({
			input: { api_key: "[redacted]", safe: [{ authToken: "[redacted]", query: "visible" }] },
		});
		store.dispose();
	});
});
