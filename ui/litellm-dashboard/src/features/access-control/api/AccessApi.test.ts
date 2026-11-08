import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessApi } from "./AccessApi";
describe("Access-control wire contracts", () => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	beforeEach(() => {
		fetch.mockReset().mockResolvedValue(new Response("{}"));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "litellm_csrf_token=fixture-csrf" });
	});
	afterEach(() => vi.unstubAllGlobals());
	function request() {
		const [url, init] = fetch.mock.calls.at(-1)!;
		return { url: String(url), init: init!, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
	}
	it("preserves the three different deletion protocols and accepts an empty204", async () => {
		await accessApi.deleteProjects(["project-a"]);
		expect(request()).toMatchObject({
			url: "/project/delete",
			init: { method: "DELETE", credentials: "include" },
			body: { project_ids: ["project-a"] },
		});
		expect(request().headers.get("x-litellm-csrf-token")).toBe("fixture-csrf");
		fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
		await expect(accessApi.deleteGroup("group/a")).resolves.toBeUndefined();
		expect(fetch.mock.calls.at(-1)).toMatchObject(["/v1/access_group/group%2Fa", { method: "DELETE" }]);
		await accessApi.deleteBudget("budget-a");
		expect(request()).toMatchObject({ url: "/budget/delete", init: { method: "POST" }, body: { id: "budget-a" } });
	});
	it("updates groups with PUT while organization budgets retain their PATCH envelope", async () => {
		await accessApi.updateGroup("group-a", { access_model_names: [] });
		expect(request()).toMatchObject({ url: "/v1/access_group/group-a", init: { method: "PUT" }, body: { access_model_names: [] } });
		await accessApi.updateOrganization({ organization_id: "org-a", litellm_budget_table: { max_budget: null } });
		expect(request()).toMatchObject({
			url: "/organization/update",
			init: { method: "PATCH" },
			body: { organization_id: "org-a", litellm_budget_table: { max_budget: null } },
		});
		expect(request().headers.has("Authorization")).toBe(false);
	});
	it("keeps zero member limits and omits nullable optional limits exactly as the existing endpoint expects", async () => {
		await accessApi.updateTeamMember("team-a", {
			role: "user",
			user_id: "user-a",
			max_budget_in_team: 0,
			tpm_limit: null,
			rpm_limit: 12,
		});
		expect(request().body).toEqual({ team_id: "team-a", role: "user", user_id: "user-a", max_budget_in_team: 0, rpm_limit: 12 });
	});
	it("distinguishes selected users from the explicit all-users bulk operation", async () => {
		await accessApi.bulkUpdateUsers({ models: ["gpt-4.1"] }, ["user-a", "user-b"]);
		expect(request().body).toEqual({
			users: [
				{ user_id: "user-a", models: ["gpt-4.1"] },
				{ user_id: "user-b", models: ["gpt-4.1"] },
			],
		});
		await accessApi.bulkUpdateUsers({ max_budget: 25 }, [], true);
		expect(request().body).toEqual({ all_users: true, user_updates: { max_budget: 25 } });
	});
	it("never creates a personal API key while inviting an account", async () => {
		await accessApi.createUser({ user_email: "person@example.test", auto_create_key: true });
		expect(request().body).toEqual({ user_id: null, user_email: "person@example.test", auto_create_key: false });
	});
	it("serializes list filters without dropping zero or adding empty filters, retaining cancellation", async () => {
		const controller = new AbortController();
		fetch.mockResolvedValueOnce(new Response(JSON.stringify({ users: [], total: 0, page: 1, page_size: 25, total_pages: 1 })));
		const response = await accessApi.users(
			{ user_ids: "a,b", sso_user_ids: "sso-a", role: "internal_user", team: "", page: 1, page_size: 25 },
			controller.signal,
		);
		const [url, init] = fetch.mock.calls[0];
		expect(String(url)).toBe("/user/list?user_ids=a%2Cb&sso_user_ids=sso-a&role=internal_user&page=1&page_size=25");
		expect(init?.signal).toBe(controller.signal);
		expect(response).toEqual({ rows: [], total: 0, page: 1, pageSize: 25, totalPages: 1 });
	});
});
