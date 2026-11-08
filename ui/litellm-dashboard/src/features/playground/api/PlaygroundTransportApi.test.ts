import { afterEach, describe, expect, it, vi } from "vitest";
import { readServerSentEvents, inferenceRequest } from "./PlaygroundTransportApi";
afterEach(() => vi.unstubAllGlobals());
describe("native Playground transport", () => {
	it("decodes UTF-8 and CRLF split across chunks and cancels the stream at DONE", async () => {
		const text = ': keepalive\r\nevent: response.output_text.delta\r\ndata: {"delta":"你好"}\r\n\r\ndata: [DONE]\r\n\r\n';
		const bytes = new TextEncoder().encode(text),
			cancel = vi.fn();
		let index = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (index < bytes.length) controller.enqueue(bytes.subarray(index, index++ + 1));
			},
			cancel,
		});
		const frames = [];
		for await (const frame of readServerSentEvents(new Response(body))) frames.push(frame);
		expect(frames).toEqual([{ delta: "你好", type: "response.output_text.delta" }]);
		expect(cancel).toHaveBeenCalledTimes(1);
	});
	it("accepts multi-line data and the final event without a blank terminator", async () => {
		const text = 'event: result\ndata: {\ndata: "value": 42\ndata: }\n\n' + 'data: {"last":true}';
		const frames = [];
		for await (const frame of readServerSentEvents(new Response(text))) frames.push(frame);
		expect(frames).toEqual([{ value: 42, type: "result" }, { last: true }]);
	});
	it("cancels a blocked reader when the user aborts", async () => {
		const controller = new AbortController(),
			cancel = vi.fn(),
			body = new ReadableStream<Uint8Array>({ cancel });
		const stream = readServerSentEvents(new Response(body), controller.signal),
			next = stream.next();
		controller.abort();
		await expect(next).rejects.toMatchObject({ name: "AbortError" });
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("keeps malformed frames strict by default and explicitly skips them without leaking their event type", async () => {
		const source = 'event: broken\ndata: {invalid}\n\ndata: {"text":"kept"}\n\ndata: [DONE]\n\n';
		const strict = readServerSentEvents(new Response(source));
		await expect(strict.next()).rejects.toThrow("Invalid streamed response");
		const frames = [];
		for await (const frame of readServerSentEvents(new Response(source), undefined, { skipMalformed: true })) frames.push(frame);
		expect(frames).toEqual([{ text: "kept" }]);
	});
	it("keeps explicit inference keys out of cookies and uses the right provider header", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response("{}"));
		vi.stubGlobal("fetch", fetch);
		await inferenceRequest(
			"/v1/messages",
			{ kind: "virtual-key", apiKey: "synthetic-key" },
			"anthropic",
			{ method: "POST" },
			"https://proxy.example.test",
		);
		const init = fetch.mock.calls[0][1] as RequestInit,
			headers = new Headers(init.headers);
		expect(init.credentials).toBe("omit");
		expect(headers.get("x-api-key")).toBe("synthetic-key");
		expect(headers.has("Authorization")).toBe(false);
	});
});
