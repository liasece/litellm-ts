import { describe, it, expect, vi, afterEach } from "vitest";
import { createTeamSelectionStore } from "./TeamSelectionStore";
import { accessApi } from "../api/AccessApi";
const team = (id: string) => ({ team_id: id, team_alias: "Synthetic " + id, models: [], members_with_roles: [], keys: [] });
afterEach(() => vi.useRealTimers());
describe("Shared team dropdown paging", () => {
	it("restricts non-admin requests, deduplicates subsequent pages, and includes searched aliases after debounce", async () => {
		vi.useFakeTimers();
		const load = vi
				.fn<typeof accessApi.teams>()
				.mockResolvedValueOnce({ rows: [team("a")], total: 3, page: 1, pageSize: 20, totalPages: 2 })
				.mockResolvedValueOnce({ rows: [team("a"), team("b")], total: 3, page: 2, pageSize: 20, totalPages: 2 })
				.mockResolvedValueOnce({ rows: [team("searched")], total: 1, page: 1, pageSize: 20, totalPages: 1 }),
			store = createTeamSelectionStore(
				() => ({ authorized: true, userId: "synthetic-user", role: "Internal User", organizationId: "org", pageSize: 20 }),
				load,
			);
		await store.refresh();
		expect(load).toHaveBeenCalledWith({
			organization_id: "org",
			team_alias: undefined,
			user_id: "synthetic-user",
			page: 1,
			page_size: 20,
		});
		store.next();
		await Promise.resolve();
		expect(store.teams.value.map((team) => team.team_id)).toEqual(["a", "b"]);
		store.queue("search");
		await vi.advanceTimersByTimeAsync(299);
		expect(load).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ team_alias: "search", page: 1 }));
		expect(store.teams.value.map((team) => team.team_id)).toEqual(["searched"]);
		store.dispose();
	});
	it("ignores a stale search response and omits the user restriction for Admin Viewer", async () => {
		let finish: ((value: Awaited<ReturnType<typeof accessApi.teams>>) => void) | undefined;
		const load = vi
				.fn<typeof accessApi.teams>()
				.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
				.mockResolvedValueOnce({ rows: [team("current")], total: 1, page: 1, pageSize: 20, totalPages: 1 }),
			store = createTeamSelectionStore(() => ({ authorized: true, userId: "viewer", role: "Admin Viewer", pageSize: 20 }), load),
			first = store.refresh();
		await store.refresh();
		finish?.({ rows: [team("stale")], total: 1, page: 1, pageSize: 20, totalPages: 1 });
		await first;
		expect(load.mock.calls[0][0]).toMatchObject({ user_id: undefined });
		expect(store.teams.value.map((team) => team.team_id)).toEqual(["current"]);
		store.dispose();
	});
});
