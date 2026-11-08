import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promptsApi, testPrompt } from "./PromptsApi";
describe("Prompt API wire compatibility", () => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	beforeEach(() => {
		fetch.mockReset().mockResolvedValue(new Response("{}"));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "litellm_csrf_token=synthetic-csrf" });
	});
	afterEach(() => vi.unstubAllGlobals());
	function last() {
		const [url, init] = fetch.mock.calls.at(-1)!;
		return { url: String(url), init: init!, headers: new Headers(init?.headers) };
	}
	it("preserves version metadata and raw prompt template fields while encoding resource IDs", async () => {
		const value = {
			prompt_spec: {
				prompt_id: "id/a",
				version: 2,
				litellm_params: { dotprompt_content: "---\nmodel: x\n---\nUser: test", extra: "kept" },
				extra: "preserved",
			},
			raw_prompt_template: { litellm_prompt_id: "raw/a", content: "test", metadata: { custom: 1 } },
			custom: "response",
		};
		fetch.mockResolvedValueOnce(new Response(JSON.stringify(value)));
		await expect(promptsApi.detail("id/a")).resolves.toEqual(value);
		expect(last().url).toBe("/prompts/id%2Fa/info");
		await promptsApi.update("id/a", { prompt_id: "new" });
		expect(last().url).toBe("/prompts/id%2Fa");
		expect(last().init.method).toBe("PUT");
		expect(last().init.credentials).toBe("include");
		expect(last().headers.get("x-litellm-csrf-token")).toBe("synthetic-csrf");
		expect(last().headers.has("Authorization")).toBe(false);
	});
	it("retains wire JSON field order in raw detail and version views while rejecting invalid known fields", async () => {
		const wire = {
			custom: "first",
			raw_prompt_template: null,
			prompt_spec: {
				extra: true,
				prompt_id: "ordered",
				litellm_params: {
					prompt_integration: "dotprompt",
					prompt_id: "ordered",
					dotprompt_content: "User: test",
					custom: { z: 1, a: 2 },
				},
			},
		};
		fetch.mockResolvedValueOnce(new Response(JSON.stringify(wire)));
		expect(JSON.stringify(await promptsApi.detail("ordered"))).toBe(JSON.stringify(wire));
		fetch.mockResolvedValueOnce(new Response(JSON.stringify({ prompts: [wire.prompt_spec] })));
		expect(JSON.stringify(await promptsApi.versions("ordered"))).toBe(JSON.stringify([wire.prompt_spec]));
		fetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ ...wire, prompt_spec: { ...wire.prompt_spec, litellm_params: { model: 42 } } })),
		);
		await expect(promptsApi.detail("ordered")).rejects.toThrow();
	});

	it("sends the converter a real multipart file without overriding its browser boundary", async () => {
		fetch.mockResolvedValueOnce(new Response('{"prompt_id":"converted","json_data":{"model":"custom"}}'));
		const file = new File(["Synthetic"], "example.prompt");
		await promptsApi.convert(file);
		expect(last().url).toBe("/utils/dotprompt_json_converter");
		expect(last().init.body).toBeInstanceOf(FormData);
		expect((last().init.body as FormData).get("file")).toBeInstanceOf(File);
		expect(last().headers.has("Content-Type")).toBe(false);
	});
	it("streams split SSE frames through the session fetch and signals response readiness before data", async () => {
		const encoder = new TextEncoder(),
			body = new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel'));
					controller.enqueue(encoder.encode('lo"}}]}\n\ndata: {"usage":{"total_tokens":5}}\n\ndata: [DONE]\n\n'));
					controller.close();
				},
			});
		fetch.mockResolvedValueOnce(new Response(body));
		const ready = vi.fn(),
			frames: Record<string, unknown>[] = [];
		for await (const frame of testPrompt({ dotprompt_content: "fixture" }, new AbortController().signal, ready)) {
			expect(ready).toHaveBeenCalledOnce();
			frames.push(frame);
		}
		expect(frames).toEqual([{ choices: [{ delta: { content: "Hello" } }] }, { usage: { total_tokens: 5 } }]);
		expect(last().url).toBe("/prompts/test");
		expect(last().init.credentials).toBe("include");
		expect(last().headers.get("x-litellm-csrf-token")).toBe("synthetic-csrf");
	});
	it("skips malformed SSE data without losing later content and usage, as the old Prompt test did", async () => {
		fetch.mockResolvedValueOnce(
			new Response(
				'data: {invalid}\n\ndata: {"choices":[{"delta":{"content":"Kept"}}]}\n\ndata: {"usage":{"total_tokens":7}}\n\ndata: [DONE]\n\n',
			),
		);
		const frames: Record<string, unknown>[] = [];
		for await (const frame of testPrompt({ dotprompt_content: "fixture" }, new AbortController().signal)) frames.push(frame);
		expect(frames).toEqual([{ choices: [{ delta: { content: "Kept" } }] }, { usage: { total_tokens: 7 } }]);
	});
});
