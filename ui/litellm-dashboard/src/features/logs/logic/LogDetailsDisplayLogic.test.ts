import { describe, expect, it } from "vitest";
import { downstreamRequest, upstreamRequest } from "./LogDetailsDisplayLogic";

const messages = [
	{ role: "user", content: "hello" },
	{ role: "assistant", content: "hi" },
];
const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe("compact detail request aliases", () => {
	it("fills downstream body.messages from the canonical messages and removes the marker", () => {
		const result = record(downstreamRequest({ body: { model: "gpt", _litellm_ref_messages: "$messages" } }, messages));
		expect(result.body).toEqual({ model: "gpt", messages });
		expect(record(result.body)).not.toHaveProperty("_litellm_ref_messages");
		expect(result).not.toHaveProperty("upstream_request");
	});

	it("resolves compact aliases for the recorded view without image restoration", () => {
		const proxy = { body: { _litellm_ref_input: "$messages" }, upstream_request: { body: {} } };
		expect(downstreamRequest(proxy, messages, false)).toEqual({ body: { input: messages } });
	});

	it("resolves both markers and leaves ordinary arrays untouched", () => {
		expect(
			downstreamRequest({ body: { _litellm_ref_messages: "$messages", _litellm_ref_input: "$messages" } }, messages, false),
		).toEqual({ body: { messages, input: messages } });
		const recorded = [{ role: "assistant", content: "recorded" }];
		expect(downstreamRequest({ body: { messages: recorded } }, messages, false)).toEqual({ body: { messages: recorded } });
	});

	it("keeps image restoration for ordinary message arrays", () => {
		const stale = [{ role: "user", content: "stale" }];
		expect(record(downstreamRequest({ body: { messages: stale } }, messages)).body).toEqual({ messages });
		expect(record(downstreamRequest({ body: { messages: stale } }, messages, false)).body).toEqual({ messages: stale });
	});
});

describe("compact upstream request aliases", () => {
	it("resolves upstream body markers from the canonical messages", () => {
		const proxy = {
			upstream_request: { url: "https://provider.test/v1/messages", body: { _litellm_ref_messages: "$messages" } },
			upstream_response: { status: 200, body: { ok: true } },
		};
		const { request, response } = upstreamRequest(proxy, messages);
		expect(request).toEqual({ url: "https://provider.test/v1/messages", body: { messages } });
		expect(response).toEqual({ status: 200, body: { ok: true } });
	});

	it("fills upstream input markers and preserves ordinary or missing upstream details", () => {
		expect(upstreamRequest({ upstream_request: { body: { _litellm_ref_input: "$messages", model: "m" } } }, messages).request).toEqual({
			body: { input: messages, model: "m" },
		});
		const ordinary = [{ role: "user", content: "raw" }];
		expect(upstreamRequest({ upstream_request: { body: { messages: ordinary } } }, messages).request).toEqual({
			body: { messages: ordinary },
		});
		expect(upstreamRequest({ upstream_response: { ok: true } }, messages)).toEqual({
			request: undefined,
			response: { ok: true },
		});
	});
});
