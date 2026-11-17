import { afterEach, describe, expect, it, vi } from "vitest";
import { logsApi } from "./LogsApi";

afterEach(() => vi.unstubAllGlobals());

describe("logs detail HTTP boundary", () => {
	it("always asks for the compact detail payload alongside the start date", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({ request_id: "req-1" }));
		vi.stubGlobal("fetch", fetch);
		await logsApi.detail("req/1", "2026-11-17 00:00:00");
		expect(fetch.mock.calls[0][0]).toBe("/spend/logs/ui/req%2F1?start_date=2026-11-17%2000%3A00%3A00&compact=true");
	});
	it("batches missing detail reads into one POST", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockImplementation(async () => Response.json({ data: [{ request_id: "req-1", status: "success" }] }));
		vi.stubGlobal("fetch", fetch);
		const requests = [
			{ request_id: "req-1", start_date: "2026-11-17 00:00:00" },
			{ request_id: "req-2", start_date: "2026-11-17 00:00:00" },
		];
		await expect(logsApi.detailsBatch(requests)).resolves.toEqual([{ request_id: "req-1", status: "success" }]);
		expect(fetch.mock.calls[0][0]).toBe("/spend/logs/ui/batch");
		expect(fetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
		expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ requests });
	});
});
