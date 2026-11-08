import { ref } from "vue";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createPromptEditorStore, emptyPrompt } from "./PromptEditorStore";
import { createPromptUploadStore } from "./PromptUploadStore";
import { createPromptConversationStore } from "./PromptConversationStore";
import { promptsApi } from "../api/PromptsApi";
import { notificationManager } from "../../notifications/logic/NotificationManager";
vi.mock("../../notifications/logic/NotificationManager", () => ({
	notificationManager: { fromBackend: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.useRealTimers();
});
describe("Prompt persistence workflows", () => {
	it("normalizes a new name and keeps zero-valued model parameters in saved Dotprompt content", async () => {
		const create = vi.spyOn(promptsApi, "create").mockResolvedValue({}),
			store = createPromptEditorStore();
		expect(store.needsPublish()).toBe(true);
		store.prompt.value.name = "Sales Support/中文";
		store.prompt.value.config = { temperature: 0, max_tokens: 0 };
		await expect(store.save()).resolves.toBe(true);
		expect(create).toHaveBeenCalledWith({
			prompt_id: "sales_support___",
			litellm_params: {
				prompt_integration: "dotprompt",
				prompt_id: "sales_support___",
				dotprompt_content: expect.stringContaining("temperature: 0\nmax_tokens: 0"),
			},
			prompt_info: { prompt_type: "db" },
		});
		expect(store.state.publish).toBe(false);
	});
	it("updates the original prompt ID after loading a historical version and preserves a single required editor message", async () => {
		const update = vi.spyOn(promptsApi, "update").mockResolvedValue({}),
			store = createPromptEditorStore({
				prompt_spec: {
					prompt_id: "original",
					version: 2,
					litellm_params: { dotprompt_content: "---\nmodel: old\n---\nUser: current" },
				},
				raw_prompt_template: null,
			});
		store.loadVersion({
			prompt_id: "original",
			version: 1,
			litellm_params: { dotprompt_content: "---\nmodel: first\n---\nUser: older" },
		});
		store.prompt.value.name = "Renamed";
		store.removeMessage(0);
		expect(store.prompt.value.messages).toHaveLength(1);
		await store.save();
		expect(update).toHaveBeenCalledWith("original", expect.objectContaining({ prompt_id: "renamed" }));
		expect(store.state.activeVersionId).toBe("original.v1");
	});
	it("closes the publish state on a failed save without reporting success or losing edited content", async () => {
		vi.spyOn(promptsApi, "create").mockRejectedValue(new Error("synthetic"));
		const store = createPromptEditorStore();
		store.prompt.value.name = "Example";
		store.state.publish = true;
		await expect(store.save()).resolves.toBe(false);
		expect(store.state.saving).toBe(false);
		expect(store.state.publish).toBe(false);
		expect(store.prompt.value.name).toBe("Example");
		expect(notificationManager.success).not.toHaveBeenCalled();
	});
	it("converts the selected upload and distinguishes the UI ID from its converted prompt ID", async () => {
		const file = new File(["Synthetic content"], "example.prompt"),
			convert = vi.fn<typeof promptsApi.convert>().mockResolvedValue({ prompt_id: "converted-id", json_data: { model: "custom" } }),
			create = vi.fn<typeof promptsApi.create>().mockResolvedValue({}),
			store = createPromptUploadStore(() => true, { ...promptsApi, convert, create });
		store.state.id = "ui-id";
		store.choose(file);
		await expect(store.save()).resolves.toBe(true);
		expect(convert).toHaveBeenCalledWith(file);
		expect(create).toHaveBeenCalledWith({
			prompt_id: "ui-id",
			litellm_params: { prompt_integration: "dotprompt", prompt_id: "converted-id", prompt_data: { model: "custom" } },
			prompt_info: { prompt_type: "db" },
		});
		expect(store.file.value).toBeNull();
	});
	it("validates upload IDs before conversion and retains an invalid-extension selection as the existing uploader does", async () => {
		const convert = vi.fn<typeof promptsApi.convert>().mockRejectedValue(new Error("not a prompt")),
			create = vi.fn<typeof promptsApi.create>(),
			store = createPromptUploadStore(() => true, { ...promptsApi, convert, create });
		store.state.id = "bad name";
		store.choose(new File(["x"], "example.txt"));
		expect(store.file.value?.name).toBe("example.txt");
		await expect(store.save()).resolves.toBe(false);
		expect(convert).not.toHaveBeenCalled();
		store.state.id = "valid";
		await expect(store.save()).resolves.toBe(false);
		expect(convert).toHaveBeenCalledTimes(1);
		expect(create).not.toHaveBeenCalled();
		expect(store.state.loading).toBe(false);
	});
});
describe("Prompt streaming conversation contracts", () => {
	it("submits variables for the first test and only submits conversation history for later messages", async () => {
		const calls: Record<string, unknown>[] = [];
		async function* stream(body: Record<string, unknown>, _signal: AbortSignal, ready?: () => void) {
			calls.push(body);
			ready?.();
			yield { model: "synthetic-model", choices: [{ delta: { content: "Hello" } }] };
			yield { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0 } };
		}
		const store = createPromptConversationStore(ref(emptyPrompt()), () => true, stream);
		store.variables.template_variables = "fixture";
		store.state.input = "first typed input";
		await store.send();
		expect(calls[0]).toMatchObject({ prompt_variables: { template_variables: "fixture" } });
		expect(calls[0]).not.toHaveProperty("conversation_history");
		expect(JSON.stringify(calls[0])).not.toContain("first typed input");
		expect(store.messages.value[1]).toMatchObject({
			role: "assistant",
			content: "Hello",
			model: "synthetic-model",
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0 },
		});
		store.state.input = "follow up";
		await store.send();
		expect(calls[1].conversation_history).toEqual([
			{ role: "user", content: "first typed input" },
			{ role: "assistant", content: "Hello" },
			{ role: "user", content: "follow up" },
		]);
		expect(calls[1]).not.toHaveProperty("prompt_variables");
		store.clear();
		expect(store.variables.template_variables).toBe("fixture");
		expect(store.state.variablesFilled).toBe(false);
		store.dispose();
	});
	it("blocks blank variables and unauthenticated requests before appending chat history", async () => {
		const stream = vi.fn(),
			store = createPromptConversationStore(ref(emptyPrompt()), () => true, stream);
		store.state.input = "hello";
		store.variables.template_variables = "  ";
		await store.send();
		expect(stream).not.toHaveBeenCalled();
		expect(store.messages.value).toEqual([]);
		const unauthorized = createPromptConversationStore(ref(emptyPrompt()), () => false, stream);
		unauthorized.state.input = "hello";
		await unauthorized.send();
		expect(notificationManager.fromBackend).toHaveBeenLastCalledWith("Access token is required");
		store.dispose();
		unauthorized.dispose();
	});
	it("aborts the actual stream when cancelled and avoids rendering abort errors", async () => {
		let aborted = false;
		async function* stream(_body: Record<string, unknown>, signal: AbortSignal, ready?: () => void) {
			ready?.();
			await new Promise<void>((_resolve, reject) =>
				signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new DOMException("Cancelled", "AbortError"));
					},
					{ once: true },
				),
			);
			yield {};
		}
		const draft = emptyPrompt();
		draft.messages = [{ role: "user", content: "plain" }];
		const store = createPromptConversationStore(ref(draft), () => true, stream);
		store.state.input = "test";
		const pending = store.send();
		await Promise.resolve();
		store.cancel();
		await pending;
		expect(aborted).toBe(true);
		expect(store.state.loading).toBe(false);
		expect(store.messages.value.map((message) => message.content)).toEqual(["test", ""]);
		expect(notificationManager.info).toHaveBeenCalledWith("Request cancelled");
		store.dispose();
	});
	it("turns a failed response into a visible assistant error and releases the pending state", async () => {
		async function* stream() {
			yield* [];
			throw new Error("synthetic failure");
		}
		const draft = emptyPrompt();
		draft.messages = [{ role: "user", content: "plain" }];
		const store = createPromptConversationStore(ref(draft), () => true, stream);
		store.state.input = "test";
		await store.send();
		expect(store.messages.value.at(-1)).toEqual({ role: "assistant", content: "Error: synthetic failure" });
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
});
