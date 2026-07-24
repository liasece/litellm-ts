import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAvailableAgents } from "./fetch_agents";

describe("fetchAvailableAgents", () => {
	const mockFetch = vi.fn();

	beforeEach(() => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: async () => [
				{ agent_id: "agent-b", agent_name: "Beta" },
				{ agent_id: "agent-a", agent_name: "Alpha" },
			],
		} as Response);
		global.fetch = mockFetch;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		[{ kind: "session" } as const, null],
		[{ kind: "virtual-key", apiKey: "custom-key" } as const, "Bearer custom-key"],
	])("uses the final discovery auth header for %o", async (auth, expectedAuthorization) => {
		const agents = await fetchAvailableAgents(auth, "https://example.com");

		const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://example.com/v1/agents");
		expect(new Headers(options.headers).get("Authorization")).toBe(expectedAuthorization);
		expect(new Headers(options.headers).get("x-api-key")).toBeNull();
		expect(agents.map((agent) => agent.agent_name)).toEqual(["Alpha", "Beta"]);
	});
});
