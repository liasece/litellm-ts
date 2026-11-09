import { describe, expect, it, vi } from "vitest";
import { createLogsSettingsStore } from "./LogsSettingsStore";
describe("spend log settings writes", () => {
	it("removes an empty retention field before updating and keeps column preferences local", async () => {
		const api = {
			list: vi.fn().mockResolvedValue([]),
			deleteField: vi.fn().mockRejectedValue(new Error("already absent")),
			update: vi.fn().mockResolvedValue({}),
		};
		const store = createLogsSettingsStore(api);
		store.state.retention = "  ";
		store.state.storePrompts = true;
		store.state.storeUpstream = false;
		store.setColumns(["team_name"]);
		expect(api.update).not.toHaveBeenCalled();
		await store.save();
		expect(api.deleteField).toHaveBeenCalledWith("general_settings", "maximum_spend_logs_retention_period");
		expect(api.update).toHaveBeenCalledWith({
			general_settings: { store_prompts_in_spend_logs: true, store_upstream_logs_in_spend_logs: false },
		});
		expect(api.deleteField.mock.invocationCallOrder[0]).toBeLessThan(api.update.mock.invocationCallOrder[0]);
		store.dispose();
	});
	it("preserves a nonempty retention value and exposes update errors without closing", async () => {
		const api = {
			list: vi.fn().mockResolvedValue([]),
			deleteField: vi.fn(),
			update: vi.fn().mockRejectedValue(new Error("permission denied")),
		};
		const store = createLogsSettingsStore(api);
		store.state.open = true;
		store.state.retention = "30d";
		await store.save();
		expect(api.deleteField).not.toHaveBeenCalled();
		expect(api.update).toHaveBeenCalledWith({
			general_settings: {
				store_prompts_in_spend_logs: false,
				store_upstream_logs_in_spend_logs: false,
				maximum_spend_logs_retention_period: "30d",
			},
		});
		expect(store.state.open).toBe(true);
		expect(store.state.error).toContain("permission denied");
		store.dispose();
	});
});
