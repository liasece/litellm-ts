import { afterEach, describe, expect, it, vi } from "vitest";
import { checkModelHealth, cancelPriceReload, removeCredential, saveModelStorage, schedulePriceReload } from "./ModelsApi";

function stubFetch() {
	const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("Models HTTP boundary", () => {
	it("saves the model storage toggle as the general settings field update", async () => {
		const fetch = stubFetch();
		await saveModelStorage(false);
		expect(fetch.mock.calls[0][0]).toBe("/config/field/update");
		expect(fetch.mock.calls[0][1]?.method).toBe("POST");
		expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
			field_name: "store_model_in_db",
			field_value: false,
			config_type: "general_settings",
		});
	});
	it("deletes the confirmed credential through its encoded resource URL", async () => {
		const fetch = stubFetch();
		await removeCredential("Research OpenAI");
		expect(fetch.mock.calls[0][0]).toBe("/credentials/Research%20OpenAI");
		expect(fetch.mock.calls[0][1]?.method).toBe("DELETE");
	});
	it("schedules the periodic price reload with the selected interval and cancels it without a query", async () => {
		const fetch = stubFetch();
		await schedulePriceReload(12);
		await cancelPriceReload();
		expect(fetch.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
			["/schedule/model_cost_map_reload?hours=12", "POST"],
			["/schedule/model_cost_map_reload", "DELETE"],
		]);
	});
	it("scopes a targeted health check to the selected deployment", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => Response.json({ healthy_count: 1, unhealthy_count: 0 }));
		vi.stubGlobal("fetch", fetch);
		await checkModelHealth("a-model");
		await checkModelHealth();
		expect(fetch.mock.calls.map((call) => call[0])).toEqual(["/health?model_id=a-model", "/health"]);
	});
});
