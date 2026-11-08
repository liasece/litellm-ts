import { afterEach, describe, it, expect, vi } from "vitest";
import { policiesApi } from "./PoliciesApi";
import { policyFixtureBase, policiesFixture } from "../../../../tests/policies/Fixtures";
afterEach(() => vi.unstubAllGlobals());
describe("policy HTTP contracts", () => {
	it("encodes policy names in version paths and sends the selected source and promotion payload", async () => {
		const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(String(input), "http://fixture.test"),
					body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
				requests.push({ path: url.pathname, method: init?.method ?? "GET", body });
				return Response.json(policiesFixture(url, init?.method ?? "GET", body)?.body ?? policyFixtureBase);
			}),
		);
		await policiesApi.createVersion("company/security", "fixture-base-v1");
		await policiesApi.setStatus("fixture-base-v2", "production");
		expect(requests).toEqual([
			{ path: "/policies/name/company%2Fsecurity/versions", method: "POST", body: { source_policy_id: "fixture-base-v1" } },
			{ path: "/policies/fixture-base-v2/status", method: "PUT", body: { version_status: "production" } },
		]);
	});
	it("retains the original options query contracts and normalizes all three response envelopes", async () => {
		const paths: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://fixture.test");
				paths.push(url.pathname + url.search);
				return Response.json(policiesFixture(url)?.body);
			}),
		);
		expect(await policiesApi.teams("fixture-admin")).toEqual(["healthcare-east", "support"]);
		expect(await policiesApi.keys()).toEqual(["prod-support", "prod-healthcare"]);
		expect(await policiesApi.models()).toEqual(["fixture-chat", "fixture-fast", "gpt-4o"]);
		expect(paths).toEqual([
			"/team/list?user_id=fixture-admin",
			"/key/list?page=1&size=100",
			"/models?include_model_access_groups=True",
		]);
	});

	it("accepts a successful create or update acknowledgement without inventing a full-record response requirement", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ status: "success" })),
		);
		const body = { policy_name: "fixture", guardrails_add: [], guardrails_remove: [] };
		await expect(policiesApi.create(body)).resolves.toEqual({ status: "success" });
		await expect(policiesApi.update("fixture-policy", body)).resolves.toEqual({ status: "success" });
	});

	it("does not turn HTTP denial into a successful attachment or policy write", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ detail: "Policy access denied" }, { status: 403 })),
		);
		await expect(policiesApi.createAttachment({ policy_name: "baseline", scope: "*" })).rejects.toThrow("Policy access denied");
		await expect(policiesApi.delete("fixture-base-v1")).rejects.toThrow("Policy access denied");
	});
});
