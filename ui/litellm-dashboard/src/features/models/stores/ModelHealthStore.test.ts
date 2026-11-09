import { describe, expect, it, vi } from "vitest";
import { modelsApi } from "../api/ModelsApi";
import { createModelHealthStore } from "./ModelHealthStore";
import type { ModelHealthResponse } from "../support/ModelModels";

describe("selected model health checks", () => {
	it("checks only the selected deployments and applies only their results", async () => {
		const checked: (string | undefined)[] = [];
		const checkModelHealth = vi.fn(async (id?: string): Promise<ModelHealthResponse> => {
			checked.push(id);
			return {
				healthy_count: 2,
				unhealthy_count: 0,
				healthy_endpoints: [{ model_id: id }, { model_id: "z-model" }],
				unhealthy_endpoints: [],
			};
		});
		const store = createModelHealthStore({ ...modelsApi, checkModelHealth });
		store.initialize(["a-model", "z-model"]);
		await store.selected(["a-model", "missing-model"]);
		expect(checked).toEqual(["a-model"]);
		expect(store.state.statuses["a-model"].status).toBe("healthy");
		expect(store.state.statuses["z-model"].status).toBe("none");
		store.dispose();
	});
});
