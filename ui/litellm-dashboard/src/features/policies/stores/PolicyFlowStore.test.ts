import { afterEach, it, expect, vi } from "vitest";
import { createPolicyFlowStore } from "./PolicyFlowStore";
import { policiesApi } from "../api/PoliciesApi";
import { policySchema } from "../api/PoliciesSchemas";
import { policyFixtureBase, policyFixtureDraft } from "../../../../tests/policies/Fixtures";
afterEach(() => vi.restoreAllMocks());
it("creates draft versions and refreshes the list before selecting published and production versions", async () => {
	const draft = policySchema.parse(policyFixtureDraft),
		selected = vi.fn(),
		saved = vi.fn(),
		back = vi.fn(),
		list = vi.spyOn(policiesApi, "versions").mockResolvedValue([draft, policySchema.parse(policyFixtureBase)]);
	const create = vi.spyOn(policiesApi, "createVersion").mockResolvedValue({ ...draft, policy_id: "fixture-v3", version_number: 3 });
	const status = vi.spyOn(policiesApi, "setStatus").mockImplementation(async (_id, next) => ({ ...draft, version_status: next }));
	const store = createPolicyFlowStore({ selected, saved, back });
	store.sync(draft);
	await store.newVersion();
	expect(create).toHaveBeenCalledWith("global-baseline");
	expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ version_number: 3 }));
	await store.setStatus("published");
	await store.setStatus("production");
	expect(status.mock.calls).toEqual([
		["fixture-base-v2", "published"],
		["fixture-base-v2", "production"],
	]);
	expect(list).toHaveBeenCalledTimes(4);
	expect(selected).toHaveBeenLastCalledWith(expect.objectContaining({ version_status: "production" }));
	store.dispose();
});
it("saves conditional action order and custom responses without changing an existing draft when a step is incomplete", async () => {
	const update = vi.spyOn(policiesApi, "update").mockResolvedValue(policySchema.parse(policyFixtureDraft));
	vi.spyOn(policiesApi, "versions").mockResolvedValue([]);
	const saved = vi.fn(),
		store = createPolicyFlowStore({ selected: vi.fn(), saved, back: vi.fn() });
	store.sync(policySchema.parse(policyFixtureDraft));
	store.state.pipeline.steps[0]!.guardrail = "";
	expect(await store.save()).toBe(false);
	expect(update).not.toHaveBeenCalled();
	store.state.pipeline.steps[0] = {
		guardrail: "fixture-pii",
		on_pass: "next",
		on_fail: "modify_response",
		modify_response_message: "Request unavailable",
	};
	expect(await store.save()).toBe(true);
	expect(update).toHaveBeenCalledWith(
		"fixture-base-v2",
		expect.objectContaining({
			guardrails_add: ["fixture-pii"],
			pipeline: expect.objectContaining({
				steps: [expect.objectContaining({ on_fail: "modify_response", modify_response_message: "Request unavailable" })],
			}),
		}),
	);
	expect(saved).toHaveBeenCalledOnce();
	store.dispose();
});
