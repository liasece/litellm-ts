import { describe, it, expect, vi } from "vitest";
import { modelsApi } from "../api/ModelsApi";
import { createModelsStore } from "./ModelsStore";
import type { ModelPage } from "../support/ModelModels";
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}
function page(name: string): ModelPage {
	return {
		data: [{ model_name: name, litellm_params: { model: name }, model_info: { id: name } }],
		total_count: 75,
		current_page: 1,
		total_pages: 2,
		size: 50,
	};
}
describe("Models list requests", () => {
	it("does not let a stale search response replace a newer scope", async () => {
		const first = deferred<ModelPage>(),
			second = deferred<ModelPage>();
		let count = 0;
		const list = vi.fn(() => (++count === 1 ? first.promise : second.promise)),
			store = createModelsStore({ ...modelsApi, listModels: list });
		const old = store.load();
		store.team("team-2");
		second.resolve(page("new-scope"));
		await Promise.resolve();
		await Promise.resolve();
		first.resolve(page("old-scope"));
		await old;
		expect(store.state.rows[0].model_name).toBe("new-scope");
		expect(list.mock.calls.length).toBe(2);
		store.dispose();
	});
	it("debounces search and resets a remote page when a local model-group filter changes", async () => {
		vi.useFakeTimers();
		const list = vi.fn<typeof modelsApi.listModels>(async () => page("model")),
			store = createModelsStore({ ...modelsApi, listModels: list });
		store.search("re");
		store.search("research");
		await vi.advanceTimersByTimeAsync(199);
		expect(list).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(list.mock.calls).toHaveLength(1);
		store.page(2);
		await Promise.resolve();
		store.setGroup("research");
		await Promise.resolve();
		expect(store.state.page).toBe(1);
		expect(list.mock.calls).toHaveLength(3);
		store.dispose();
		vi.useRealTimers();
	});
	it("maps the displayed price sort onto the backend costs contract", async () => {
		const list = vi.fn<typeof modelsApi.listModels>(async () => page("model")),
			store = createModelsStore({ ...modelsApi, listModels: list });
		store.setSort("input_cost", "desc");
		await Promise.resolve();
		expect(list.mock.calls[0][0]).toMatchObject({ sortBy: "costs", sortOrder: "desc", page: 1, size: 50 });
		store.dispose();
	});
	it("polls cooldown state in the background without showing a loading state", async () => {
		vi.useFakeTimers();
		try {
			const initial = page("model"),
				withCooldown = page("model");
			withCooldown.data[0].cooldown = {
				deployment_id: "model",
				duration_ms: 60_000,
				remaining_ms: 42_000,
				expires_at: "2026-11-19T10:00:00.000Z",
			};
			const list = vi.fn<typeof modelsApi.listModels>().mockResolvedValueOnce(initial).mockResolvedValueOnce(withCooldown),
				store = createModelsStore({ ...modelsApi, listModels: list });
			await store.load();
			store.startAutoRefresh();
			await vi.advanceTimersByTimeAsync(4_999);
			expect(list).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(list).toHaveBeenCalledTimes(2);
			expect(store.state.rows[0].cooldown?.remaining_ms).toBe(42_000);
			expect(store.state.loading).toBe(false);
			store.dispose();
			await vi.advanceTimersByTimeAsync(5_000);
			expect(list).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
