import { afterEach, describe, expect, it, vi } from "vitest";
import { accessApi } from "./AccessApi";
afterEach(() => vi.unstubAllGlobals());
describe("Access HTTP boundary", () => {
	it("uses the real team and organization member add/delete contracts", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
		vi.stubGlobal("fetch", fetch);
		await accessApi.addTeamMember("team-a", { user_id: "user-a", role: "user" });
		await accessApi.deleteTeamMember("team-a", { user_id: "user-a", role: "user" });
		await accessApi.addOrganizationMember("org-a", { user_id: "user-a", role: "internal_user" });
		await accessApi.deleteOrganizationMember("org-a", "user-a");
		expect(fetch.mock.calls.map((call) => call[0])).toEqual([
			"/team/member_add",
			"/team/member_delete",
			"/organization/member_add",
			"/organization/member_delete",
		]);
		expect(fetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
			{ team_id: "team-a", member: { user_id: "user-a", role: "user" } },
			{ team_id: "team-a", user_id: "user-a" },
			{ organization_id: "org-a", member: { user_id: "user-a", role: "internal_user" } },
			{ organization_id: "org-a", user_id: "user-a" },
		]);
	});
	it("reads the user detail envelope from the real user info route", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(Response.json({ user_info: { user_id: "user-a", models: [], user_email: "a@example.com" } }));
		vi.stubGlobal("fetch", fetch);
		const user = await accessApi.user("user-a");
		expect(String(fetch.mock.calls[0][0])).toBe("/user/info?user_id=user-a");
		expect(user).toMatchObject({ user_id: "user-a", user_email: "a@example.com", models: [] });
	});
	it("creates users with the real user creation route", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
		vi.stubGlobal("fetch", fetch);
		await accessApi.createUser({ user_email: "a@example.com", user_role: "internal_user" });
		expect(fetch.mock.calls[0][0]).toBe("/user/new");
		expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
			user_id: null,
			user_email: "a@example.com",
			user_role: "internal_user",
			auto_create_key: false,
		});
	});
});
