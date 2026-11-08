import { afterEach, it, expect, vi } from "vitest";
import { enrichPolicyStream } from "./PolicyEnrichmentStreamApi";
afterEach(() => vi.unstubAllGlobals());
it("reads split enrichment events, skips malformed lines, and retains refinement competitors in the request", async () => {
	const events: string[] = [],
		done = vi.fn(),
		error = vi.fn(),
		fetch = vi.fn<typeof globalThis.fetch>(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							const encoder = new TextEncoder();
							for (const text of [
								'data: {"type":"sta',
								'tus","message":"Searching"}\n\ndata: broken\n\ndata: {"type":"competitor","name":"Fixture Air"}\n',
								'\ndata: {"type":"error","message":"partial warning"}\n\ndata: {"type":"done","competitors":["Fixture Air"],"guardrailDefinitions":[]}\n\n',
							])
								controller.enqueue(encoder.encode(text));
							controller.close();
						},
					}),
				),
		);
	vi.stubGlobal("fetch", fetch);
	await enrichPolicyStream(
		"fixture-brand",
		{ brand_name: "Brand" },
		"fixture-chat",
		{ status: (v) => events.push(v), competitor: (v) => events.push(v), done, error },
		{ instruction: "Add more", existingCompetitors: ["Existing"] },
	);
	expect(events).toEqual(["Searching", "Fixture Air"]);
	expect(error).toHaveBeenCalledWith("partial warning");
	expect(done).toHaveBeenCalledWith({ competitors: ["Fixture Air"], guardrailDefinitions: [], competitor_variations: {} });
	const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
	expect(JSON.parse(String(init?.body))).toEqual({
		template_id: "fixture-brand",
		parameters: { brand_name: "Brand" },
		model: "fixture-chat",
		instruction: "Add more",
		competitors: ["Existing"],
	});
});
