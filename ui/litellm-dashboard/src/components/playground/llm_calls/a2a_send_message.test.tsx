import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeA2ASendMessageRequest, makeA2AStreamMessageRequest } from "./a2a_send_message";

const encoder = new TextEncoder();

describe("a2a_send_message", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("sends regular A2A messages through the session transport without an API key header", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({
				jsonrpc: "2.0",
				id: "request",
				result: { parts: [{ kind: "text", text: "hello" }] },
			}),
		} as Response);
		const signal = new AbortController().signal;
		const onTextUpdate = vi.fn();

		await makeA2ASendMessageRequest(
			"agent-1",
			"question",
			onTextUpdate,
			{ kind: "session" },
			signal,
			undefined,
			undefined,
			undefined,
			"https://example.com",
			["guardrail-a"],
		);

		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://example.com/a2a/agent-1/message/send");
		expect(new Headers(options.headers).get("Authorization")).toBeNull();
		expect(new Headers(options.headers).get("x-api-key")).toBeNull();
		expect(options.signal).toBe(signal);
		expect(JSON.parse(options.body as string)).toMatchObject({
			method: "message/send",
			params: { message: { parts: [{ kind: "text", text: "question" }] }, metadata: { guardrails: ["guardrail-a"] } },
		});
		expect(onTextUpdate).toHaveBeenCalledWith("hello", "a2a_agent/agent-1");
	});

	it("sends regular A2A messages with the custom Bearer header", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ jsonrpc: "2.0", id: "request", result: { parts: [{ kind: "text", text: "hello" }] } }),
		} as Response);

		await makeA2ASendMessageRequest(
			"agent-1",
			"question",
			vi.fn(),
			{ kind: "virtual-key", apiKey: "custom-key" },
			undefined,
			undefined,
			undefined,
			undefined,
			"https://example.com",
		);

		const options = mockFetch.mock.calls[0][1] as RequestInit;
		expect(new Headers(options.headers).get("Authorization")).toBe("Bearer custom-key");
		expect(new Headers(options.headers).get("x-api-key")).toBeNull();
	});

	it("sends streaming A2A messages with the custom Bearer header and preserves NDJSON parsing", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						'{"result":{"kind":"artifact-update","artifact":{"parts":[{"kind":"text","text":"hel"}]}}}\n' +
							'{"result":{"kind":"artifact-update","artifact":{"parts":[{"kind":"text","text":"lo"}]}}}\n',
					),
				);
				controller.close();
			},
		});
		mockFetch.mockResolvedValue({ ok: true, body: stream } as Response);
		const signal = new AbortController().signal;
		const onTextUpdate = vi.fn();

		await makeA2AStreamMessageRequest(
			"agent-2",
			"question",
			onTextUpdate,
			{ kind: "virtual-key", apiKey: "custom-key" },
			signal,
			undefined,
			undefined,
			undefined,
			"https://example.com",
		);

		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://example.com/a2a/agent-2");
		expect(new Headers(options.headers).get("Authorization")).toBe("Bearer custom-key");
		expect(new Headers(options.headers).get("x-api-key")).toBeNull();
		expect(options.signal).toBe(signal);
		expect(JSON.parse(options.body as string)).toMatchObject({
			method: "message/stream",
			params: { message: { parts: [{ kind: "text", text: "question" }] } },
		});
		expect(onTextUpdate).toHaveBeenNthCalledWith(1, "hel", "a2a_agent/agent-2");
		expect(onTextUpdate).toHaveBeenNthCalledWith(2, "hello", "a2a_agent/agent-2");
	});

	it("sends streaming A2A messages through the session transport without an API key header", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			body: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
		} as Response);

		await makeA2AStreamMessageRequest(
			"agent-2",
			"question",
			vi.fn(),
			{ kind: "session" },
			undefined,
			undefined,
			undefined,
			undefined,
			"https://example.com",
		);

		const options = mockFetch.mock.calls[0][1] as RequestInit;
		expect(new Headers(options.headers).get("Authorization")).toBeNull();
		expect(new Headers(options.headers).get("x-api-key")).toBeNull();
	});
});
