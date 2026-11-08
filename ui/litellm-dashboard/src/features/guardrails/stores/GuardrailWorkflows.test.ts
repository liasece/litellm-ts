import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import { createGuardrailDetailStore } from "./GuardrailDetailStore";
import { createGuardrailCustomCodeStore } from "./GuardrailCustomCodeStore";
import { createGuardrailTestStore } from "./GuardrailTestStore";
import { createGuardrailSubmissionsStore } from "./GuardrailSubmissionsStore";
import { guardrailsApi } from "../api/GuardrailsApi";
import { guardrailExecutionApi } from "../api/GuardrailExecutionApi";
import { guardrailSubmissionsApi } from "../api/GuardrailSubmissionsApi";
import { notificationManager } from "../../notifications/logic/NotificationManager";
vi.mock("../../notifications/logic/NotificationManager", () => ({
	notificationManager: { success: vi.fn(), fromBackend: vi.fn(), info: vi.fn() },
}));
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.useRealTimers();
});
describe("Custom code testing and persistence", () => {
	it("rejects malformed test JSON without an HTTP call and does not erase test input on reopen", async () => {
		const custom = vi.spyOn(guardrailExecutionApi, "custom"),
			store = createGuardrailCustomCodeStore(() => true);
		store.state.testInput = "{invalid";
		await store.test();
		expect(store.state.testResult).toEqual({ error: "Invalid test input JSON" });
		expect(custom).not.toHaveBeenCalled();
		store.initialize();
		expect(store.state.testInput).toBe("{invalid");
		expect(store.state.testResult).toBeNull();
	});
	it("reports native input errors for scalar JSON without submitting an invalid test request", async () => {
		const custom = vi.spyOn(guardrailExecutionApi, "custom"),
			store = createGuardrailCustomCodeStore(() => true);
		for (const json of ["null", "7", '"text"']) {
			store.state.testInput = json;
			await store.test();
			expect(store.state.testResult?.error).toMatch(/Cannot (read properties|create property)/);
			expect(store.state.testing).toBe(false);
		}
		expect(custom).not.toHaveBeenCalled();
	});
	it("adds a missing texts array, selects response mode, and exposes remote test errors", async () => {
		const custom = vi
				.spyOn(guardrailExecutionApi, "custom")
				.mockResolvedValue({ success: false, error: "Synthetic error", error_type: "SyntheticType" }),
			store = createGuardrailCustomCodeStore(() => true);
		store.state.testInput = '{"tools":[]}';
		store.state.mode = ["post_mcp_call"];
		await store.test();
		expect(custom).toHaveBeenCalledWith(
			expect.objectContaining({
				test_input: { tools: [], texts: [] },
				input_type: "response",
				request_data: { model: "test-model", metadata: {} },
			}),
		);
		expect(store.state.testResult).toEqual({ error: "Synthetic error", error_type: "SyntheticType" });
		expect(store.state.testing).toBe(false);
	});
	it("sends raw validated name and code, retaining edited content after a failed save", async () => {
		const create = vi.spyOn(guardrailsApi, "create").mockRejectedValue(new Error("synthetic")),
			store = createGuardrailCustomCodeStore(() => true);
		store.state.name = " Example ";
		store.state.code = " def apply_guardrail(): pass ";
		await expect(store.save()).resolves.toBe(false);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				guardrail_name: " Example ",
				litellm_params: expect.objectContaining({ custom_code: " def apply_guardrail(): pass " }),
			}),
		);
		expect(store.state.code).toBe(" def apply_guardrail(): pass ");
		expect(store.state.saving).toBe(false);
		expect(notificationManager.success).not.toHaveBeenCalled();
	});
});
describe("Guardrail optional parameter editing", () => {
	it("initializes existing flattened false and zero settings without inventing an update", async () => {
		vi.spyOn(guardrailsApi, "detail").mockResolvedValue({
			guardrail_id: "synthetic",
			guardrail_name: "Example",
			litellm_params: { guardrail: "presidio", mode: "pre_call", default_on: false, enabled: false, threshold: 0 },
			guardrail_info: { description: "Synthetic" },
		});
		vi.spyOn(guardrailsApi, "providers").mockResolvedValue({
			presidio: {
				optional_params: {
					fields: {
						enabled: { type: "bool", default_value: true },
						threshold: { type: "number", default_value: 0.5 },
					},
				},
			},
		});
		vi.spyOn(guardrailsApi, "settings").mockResolvedValue({
			supported_entities: [],
			supported_actions: [],
			supported_modes: [],
			pii_entity_categories: [],
		});
		const update = vi.spyOn(guardrailsApi, "update"),
			store = createGuardrailDetailStore("synthetic", () => true);
		await store.load();
		await store.metadata();
		expect(store.values.value.optional_params).toMatchObject({ enabled: false, threshold: 0 });
		await expect(store.save()).resolves.toBe(true);
		expect(update).not.toHaveBeenCalled();
		expect(notificationManager.info).toHaveBeenCalledWith("No changes detected");
		store.dispose();
	});
});
describe("Parallel guardrail comparisons", () => {
	it("starts all selected guardrails concurrently and keeps completion order with partial failure", async () => {
		let complete: ((value: { response_text: string }) => void) | undefined;
		const apply = vi
				.spyOn(guardrailExecutionApi, "apply")
				.mockImplementation((name) =>
					name === "slow"
						? new Promise((resolve) => (complete = resolve))
						: name === "failure"
							? Promise.reject(new Error("synthetic failure"))
							: Promise.resolve({ response_text: "fast response" }),
				),
			store = createGuardrailTestStore(() => true);
		["slow", "fast", "failure"].forEach(store.toggle);
		const pending = store.test(" raw synthetic input ");
		expect(apply).toHaveBeenCalledTimes(3);
		await Promise.resolve();
		complete?.({ response_text: "slow response" });
		await pending;
		expect(store.results.value.map((row) => row.guardrailName)).toEqual(["fast", "slow"]);
		expect(store.errors.value[0].error.message).toBe("synthetic failure");
		expect(store.pending.value).toBe(false);
		expect(apply).toHaveBeenNthCalledWith(1, "slow", " raw synthetic input ");
	});
	it("keeps selected guards after search and does not run without authorization", async () => {
		const apply = vi.spyOn(guardrailExecutionApi, "apply"),
			store = createGuardrailTestStore(() => false);
		store.toggle("original");
		store.search.value = "hidden";
		await store.test("input");
		expect(store.selected.value.has("original")).toBe(true);
		expect(apply).not.toHaveBeenCalled();
	});
});
describe("Submitted guardrail mutations", () => {
	const submission = {
			guardrail_id: "id",
			guardrail_name: "Synthetic",
			status: "pending_review",
			litellm_params: { forward_api_key: true },
		},
		summary = { total: 1, pending_review: 1, active: 0, rejected: 0 };
	it("debounces search requests, maps pending status to pending_review, and preserves server filtering", async () => {
		vi.useFakeTimers();
		const list = vi.spyOn(guardrailSubmissionsApi, "list").mockResolvedValue({ submissions: [submission], summary }),
			store = createGuardrailSubmissionsStore(() => true);
		store.state.search = " first ";
		await nextTick();
		store.state.search = " final ";
		await nextTick();
		await vi.advanceTimersByTimeAsync(299);
		expect(list).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(list).toHaveBeenLastCalledWith({ status: undefined, search: "final" });
		store.state.status = "pending";
		await nextTick();
		expect(list).toHaveBeenLastCalledWith({ status: "pending_review", search: "final" });
		store.dispose();
	});
	it("keeps the current forward setting after rejection and only updates after a successful PATCH", async () => {
		vi.spyOn(guardrailSubmissionsApi, "list").mockResolvedValue({ submissions: [submission], summary });
		const patch = vi.spyOn(guardrailsApi, "update").mockRejectedValueOnce(new Error("synthetic")).mockResolvedValue({}),
			store = createGuardrailSubmissionsStore(() => true);
		await store.load();
		await store.forward("id");
		expect(store.rows.value[0].forwardKey).toBe(true);
		await store.forward("id");
		expect(store.rows.value[0].forwardKey).toBe(false);
		expect(patch).toHaveBeenLastCalledWith("id", { litellm_params: { forward_api_key: false } });
		store.dispose();
	});
	it("keeps confirmation open when review fails and refetches/clears selection only on success", async () => {
		const list = vi.spyOn(guardrailSubmissionsApi, "list").mockResolvedValue({ submissions: [submission], summary }),
			review = vi
				.spyOn(guardrailSubmissionsApi, "review")
				.mockRejectedValueOnce(new Error("synthetic"))
				.mockResolvedValue({ guardrail_id: "id", status: "active", message: "Approved" }),
			store = createGuardrailSubmissionsStore(() => true);
		await store.load();
		store.state.selectedId = "id";
		store.confirmation.value = { id: "id", action: "approve" };
		await store.review();
		expect(store.confirmation.value).not.toBeNull();
		expect(store.state.selectedId).toBe("id");
		await store.review();
		expect(review).toHaveBeenLastCalledWith("id", "approve");
		expect(list).toHaveBeenCalledTimes(2);
		expect(store.confirmation.value).toBeNull();
		expect(store.state.selectedId).toBe("");
		store.dispose();
	});
});
