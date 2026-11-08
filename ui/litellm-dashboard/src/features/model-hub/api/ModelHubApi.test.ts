import { afterEach, describe, expect, it, vi } from "vitest";
import { modelHubApi } from "./ModelHubApi";
afterEach(() => vi.unstubAllGlobals());
describe("Hub HTTP contracts", () => {
	it("reads anonymous public catalogs without an Authorization header or a session precondition", async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify([{ model_group: "public-model", providers: ["openai"] }]), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetch);
		const models = await modelHubApi.publicModels();
		expect(models[0].model_group).toBe("public-model");
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("/public/model_hub");
		expect(new Headers(init.headers).has("Authorization")).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("preserves the legacy empty public list on HTTP failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("Unauthorized", { status: 401 })),
		);
		expect(await modelHubApi.publicModels()).toEqual([]);
	});
	it("flattens agent cards and honors the explicit public flag before the legacy litellm flag", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify([
							{
								agent_id: "agent",
								agent_card_params: { name: "Research", url: "https://example.test", version: "1" },
								is_public: false,
								litellm_params: { is_public: true },
							},
						]),
						{ status: 200 },
					),
			),
		);
		const [agent] = await modelHubApi.agents();
		expect(agent).toMatchObject({ agent_id: "agent", name: "Research", is_public: false });
		expect(agent.skills).toEqual([]);
	});

	it("rejects publication after an HTTP 403 instead of reporting a successful write", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ detail: "Forbidden fixture" }), { status: 403 })),
		);
		await expect(modelHubApi.publish("models", ["fixture-model"])).rejects.toThrow("Forbidden fixture");
	});
	it("sends the three explicit publish selections using their original endpoint/body fields", async () => {
		const requests: { url: string; body: unknown; auth: boolean }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				requests.push({
					url: String(input),
					body: JSON.parse(String(init.body)),
					auth: new Headers(init.headers).has("Authorization"),
				});
				return new Response("{}");
			}),
		);
		await modelHubApi.publish("models", ["model"]);
		await modelHubApi.publish("agents", ["agent"]);
		await modelHubApi.publish("mcp", ["server"]);
		expect(requests).toEqual([
			{ url: "/model_group/make_public", body: { model_groups: ["model"] }, auth: false },
			{ url: "/v1/agents/make_public", body: { agent_ids: ["agent"] }, auth: false },
			{ url: "/v1/mcp/make_public", body: { mcp_server_ids: ["server"] }, auth: false },
		]);
	});
});
