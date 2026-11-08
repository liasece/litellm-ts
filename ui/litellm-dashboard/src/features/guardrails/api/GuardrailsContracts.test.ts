import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { guardrailsMonitorApi } from "./GuardrailsMonitorApi";
import { toolPoliciesApi } from "./ToolPoliciesApi";
const row = { tool_id: "tool-id", tool_name: "example", input_policy: "untrusted", output_policy: "trusted" };
describe("Guardrail monitor and discovered tool wire contracts", () => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	beforeEach(() => {
		fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify(row)));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "litellm_csrf_token=synthetic-csrf" });
	});
	afterEach(() => vi.unstubAllGlobals());
	function last() {
		const [url, init] = fetch.mock.calls.at(-1)!;
		return {
			url: String(url),
			init: init!,
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		};
	}
	it("retains monitor dates, encoded identifiers, and explicitly supplied zero pagination values", async () => {
		fetch.mockResolvedValueOnce(new Response('{"logs":[],"total":0}'));
		await guardrailsMonitorApi.logs({
			guardrailId: "id/a",
			policyId: "policy",
			page: 0,
			pageSize: 0,
			action: "blocked",
			startDate: "2026-01-01",
			endDate: "2026-01-02",
		});
		const query = new URL(last().url, "https://example.test").searchParams;
		expect(Object.fromEntries(query)).toEqual({
			guardrail_id: "id/a",
			policy_id: "policy",
			page: "0",
			page_size: "0",
			action: "blocked",
			start_date: "2026-01-01",
			end_date: "2026-01-02",
		});
		fetch.mockResolvedValueOnce(
			new Response(
				'{"guardrail_name":"Example","status":"healthy","provider":"Custom","type":"custom","requestsEvaluated":0,"failRate":0}',
			),
		);
		await guardrailsMonitorApi.detail("id/a", "2026-01-01", "2026-01-02");
		expect(last().url).toBe("/guardrails/usage/detail/id%2Fa?start_date=2026-01-01&end_date=2026-01-02");
	});
	it("accepts the current backend snake case overview without reinterpreting it as new UI totals", async () => {
		fetch.mockResolvedValueOnce(new Response('{"total_evaluations":9,"blocked_requests":2,"guardrails":[]}'));
		await expect(guardrailsMonitorApi.overview()).resolves.toMatchObject({ rows: [], total_evaluations: 9, blocked_requests: 2 });
	});
	it("sends team and key override omissions exactly and uses Cookie+CSRF instead of bearer authentication", async () => {
		await toolPoliciesApi.update(
			"name/a",
			{ input_policy: "blocked" },
			{ team_id: "", key_hash: "synthetic-reference", key_alias: "" },
		);
		expect(last()).toMatchObject({
			url: "/v1/tool/policy",
			init: { method: "POST", credentials: "include" },
			body: { tool_name: "name/a", input_policy: "blocked", key_hash: "synthetic-reference" },
		});
		expect(last().body).not.toHaveProperty("team_id");
		expect(last().body).not.toHaveProperty("key_alias");
		expect(last().headers.get("x-litellm-csrf-token")).toBe("synthetic-csrf");
		expect(last().headers.has("Authorization")).toBe(false);
		fetch.mockResolvedValueOnce(new Response('{"deleted":true,"tool_name":"name/a"}'));
		await toolPoliciesApi.deleteOverride("name/a", { team_id: "", key_hash: "ref/a" });
		expect(last().url).toBe("/v1/tool/name%2Fa/overrides?key_hash=ref%2Fa");
		expect(last().init.method).toBe("DELETE");
		expect(last().init.body).toBeUndefined();
		expect(last().headers.has("Content-Type")).toBe(false);
	});
	it("keeps request text errors used by the original policy alert and uses the dedicated key catalogue query", async () => {
		fetch.mockResolvedValueOnce(new Response("synthetic upstream rejection", { status: 400 }));
		await expect(toolPoliciesApi.update("example", { output_policy: "trusted" })).rejects.toThrow("synthetic upstream rejection");
		fetch.mockResolvedValueOnce(new Response('{"keys":[{"api_key":"synthetic-reference","key_alias":null}]}'));
		await expect(toolPoliciesApi.keys()).resolves.toEqual([{ token: "synthetic-reference", key_alias: "syntheti" }]);
		expect(last().url).toBe("/key/list?page=1&size=100&return_full_object=true&include_team_keys=true&include_created_by_keys=true");
	});
});
