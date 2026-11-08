import { describe, expect, it, vi } from "vitest";
import { createUsageAiStore } from "./UsageAiStore";
import type { UsageAiEvent } from "../support/UsageAiModels";
describe("usage assistant lifecycle", () => {
	it("streams tool progress and text into one assistant message with only the last 20 history entries", async () => {
		const stream = vi.fn(async function* () {
			yield { type: "status", message: "Reading usage" } as UsageAiEvent;
			yield {
				type: "tool_call",
				tool_name: "get_usage_data",
				tool_label: "Usage",
				arguments: { start_date: "2026-11-01" },
				status: "running",
			} as UsageAiEvent;
			yield { type: "chunk", content: "Total: " } as UsageAiEvent;
			yield { type: "chunk", content: "$3" } as UsageAiEvent;
			yield {
				type: "tool_call",
				tool_name: "get_usage_data",
				tool_label: "Usage",
				arguments: {},
				status: "complete",
			} as UsageAiEvent;
			yield { type: "done" } as UsageAiEvent;
		});
		const store = createUsageAiStore({ models: vi.fn().mockResolvedValue([]), stream });
		store.state.messages = Array.from({ length: 25 }, (_, i) => ({ role: "user", content: String(i) }));
		store.state.input = "  this week?  ";
		store.state.selectedModel = "model-a";
		await store.send();
		const args = stream.mock.calls[0] as unknown as [Array<{ role: string; content: string }>, string, AbortSignal];
		expect(args[0]).toHaveLength(20);
		expect(args[0].at(-1)).toEqual({ role: "user", content: "this week?" });
		expect(args[1]).toBe("model-a");
		expect(store.state.messages.at(-1)).toMatchObject({ role: "assistant", content: "Total: $3", toolCalls: [{ status: "complete" }] });
		expect(store.state.streaming).toBe("");
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
	it("Clear aborts an active stream and suppresses its delayed completion", async () => {
		let resume!: () => void, signal: AbortSignal | undefined;
		const stream = vi.fn(async function* (
			_messages: { role: "user" | "assistant"; content: string }[],
			_model: string,
			current: AbortSignal,
		) {
			signal = current;
			yield { type: "chunk", content: "partial" } as UsageAiEvent;
			await new Promise<void>((r) => (resume = r));
			yield { type: "done" } as UsageAiEvent;
		});
		const store = createUsageAiStore({ models: vi.fn().mockResolvedValue([]), stream });
		store.state.input = "spend?";
		const pending = store.send();
		await vi.waitFor(() => expect(store.state.streaming).toBe("partial"));
		store.clear();
		expect(signal?.aborted).toBe(true);
		resume();
		await pending;
		expect(store.state.messages).toEqual([]);
		expect(store.state.streaming).toBe("");
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
	it("keeps a server error as an assistant message and leaves the next send enabled", async () => {
		const store = createUsageAiStore({
			models: vi.fn().mockResolvedValue([]),
			stream: async function* () {
				yield { type: "error", message: "No available model" };
			},
		});
		store.state.input = "spend?";
		await store.send();
		expect(store.state.messages.at(-1)?.content).toBe("Error: No available model");
		expect(store.state.loading).toBe(false);
		store.dispose();
	});
});
