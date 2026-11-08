import { afterEach, describe, expect, it, vi } from "vitest";
import { modelHubApi } from "../api/ModelHubApi";
import { createPublicModelHubGateStore } from "./PublicModelHubGateStore";
import { createModelHubPublishStore } from "./ModelHubPublishStore";
import { createModelHubLinksStore } from "./ModelHubLinksStore";
vi.mock("../../notifications/logic/NotificationManager", () => ({ notificationManager: { success: vi.fn(), fromBackend: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
describe("Hub access and editing", () => {
	it("keeps anonymous public tables independent from private model/config requests", async () => {
		vi.spyOn(modelHubApi, "settings").mockResolvedValue({ require_auth_for_public_ai_hub: false });
		const publicModels = vi.spyOn(modelHubApi, "publicModels").mockResolvedValue([]),
			models = vi.spyOn(modelHubApi, "models"),
			session = vi.spyOn(modelHubApi, "session"),
			redirect = vi.fn();
		const gate = createPublicModelHubGateStore(redirect);
		await gate.load(false);
		expect(gate.state).toMatchObject({ ready: true, allowed: true });
		expect(publicModels).toHaveBeenCalledOnce();
		expect(models).not.toHaveBeenCalled();
		expect(session).not.toHaveBeenCalled();
		expect(redirect).not.toHaveBeenCalled();
		gate.dispose();
	});
	it("redirects an unauthenticated protected public table before loading catalog data", async () => {
		vi.spyOn(modelHubApi, "settings").mockResolvedValue({ require_auth_for_public_ai_hub: true });
		vi.spyOn(modelHubApi, "session").mockResolvedValue(false);
		const models = vi.spyOn(modelHubApi, "publicModels"),
			redirect = vi.fn(),
			gate = createPublicModelHubGateStore(redirect);
		await gate.load(false);
		expect(redirect).toHaveBeenCalledWith("/ui/login");
		expect(models).not.toHaveBeenCalled();
		expect(gate.state.allowed).toBe(false);
		gate.dispose();
	});
	it("preselects public resources, retains selections when filtering, and only closes after successful publication", async () => {
		const items = [
				{ id: "a", name: "A", public: true, description: "", badges: [] },
				{ id: "b", name: "B", public: false, description: "", badges: [] },
			],
			close = vi.fn(),
			success = vi.fn(),
			store = createModelHubPublishStore("models", () => items, close, success);
		store.initialize();
		store.toggle("b", true);
		expect([...store.state.selected]).toEqual(["a", "b"]);
		store.next();
		const publish = vi.spyOn(modelHubApi, "publish").mockRejectedValueOnce(new Error("forbidden"));
		await store.submit();
		expect(store.state.step).toBe(1);
		expect(close).not.toHaveBeenCalled();
		publish.mockResolvedValueOnce({});
		await store.submit();
		expect(publish).toHaveBeenLastCalledWith("models", ["a", "b"], expect.any(AbortSignal));
		expect(close).toHaveBeenCalledOnce();
		expect(success).toHaveBeenCalledOnce();
		expect(store.state.selected.size).toBe(0);
		store.dispose();
	});
	it("keeps link edits and order local until a successful save and restores canceled reorder", async () => {
		vi.spyOn(modelHubApi, "info").mockResolvedValue({
			custom_docs_description: null,
			litellm_version: "1",
			useful_links: {
				Docs: { url: "https://docs.example.test", index: 0 },
				Support: { url: "https://support.example.test", index: 1 },
			},
		});
		const store = createModelHubLinksStore();
		await store.load();
		store.rearrange();
		store.move(0, 1);
		expect(store.state.links[0].displayName).toBe("Support");
		store.cancelOrder();
		expect(store.state.links[0].displayName).toBe("Docs");
		const save = vi.spyOn(modelHubApi, "saveLinks").mockRejectedValueOnce(new Error("forbidden"));
		store.edit(store.state.links[0]);
		if (store.state.editing) store.state.editing.displayName = "Documentation";
		await store.update();
		expect(store.state.links[0].displayName).toBe("Docs");
		expect(store.state.editing?.displayName).toBe("Documentation");
		save.mockResolvedValueOnce({});
		await store.update();
		expect(store.state.links[0].displayName).toBe("Documentation");
		expect(save).toHaveBeenLastCalledWith(
			{ Documentation: { url: "https://docs.example.test", index: 0 }, Support: { url: "https://support.example.test", index: 1 } },
			expect.any(AbortSignal),
		);
		store.dispose();
	});
});
