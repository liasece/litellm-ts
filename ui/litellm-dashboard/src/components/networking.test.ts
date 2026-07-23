import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Networking from "./networking";

vi.mock("@/utils/cookieUtils", () => ({
	getCookie: vi.fn(),
}));

vi.mock("./molecules/notifications_manager", () => ({
	default: {
		info: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		fromBackend: vi.fn(),
	},
}));

describe("networking - expired session handling", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("dashboardFetch 应携带 cookie credentials，写请求附加 CSRF 且不注入 bearer key", async () => {
		const cookieUtils = await import("@/utils/cookieUtils");
		vi.mocked(cookieUtils.getCookie).mockReturnValue("csrf-value");
		const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
		global.fetch = mockFetch as typeof global.fetch;

		await Networking.dashboardFetch("/config/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});

		expect(mockFetch).toHaveBeenCalledOnce();
		const [, init] = mockFetch.mock.calls[0]!;
		expect(init.credentials).toBe("include");
		const headers = new Headers(init.headers);
		expect(headers.get("x-litellm-csrf-token")).toBe("csrf-value");
		expect(headers.get("Authorization")).toBeNull();
	});

	it("session 查询与注销均使用 cookie，注销请求附加 CSRF", async () => {
		const cookieUtils = await import("@/utils/cookieUtils");
		vi.mocked(cookieUtils.getCookie).mockReturnValue("csrf-value");
		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ authenticated: true, user_id: "user-1" }),
			} as any)
			.mockResolvedValueOnce({ ok: true } as Response);
		global.fetch = mockFetch as typeof global.fetch;

		await Networking.getWebUiSession();
		await Networking.logoutWebUiSession();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const [sessionUrl, sessionInit] = mockFetch.mock.calls[0]!;
		expect(String(sessionUrl)).toContain("/auth/session");
		expect(sessionInit.credentials).toBe("include");
		expect(new Headers(sessionInit.headers).get("x-litellm-csrf-token")).toBeNull();

		const [logoutUrl, logoutInit] = mockFetch.mock.calls[1]!;
		expect(String(logoutUrl)).toContain("/auth/logout");
		expect(logoutInit.credentials).toBe("include");
		expect(new Headers(logoutInit.headers).get("x-litellm-csrf-token")).toBe("csrf-value");
		expect(new Headers(logoutInit.headers).get("Authorization")).toBeNull();
	});

	it("should surface backend detail error when updateSSOSettings fails", async () => {
		expect.hasAssertions();

		const backendError = {
			detail: {
				error: "Set `'STORE_MODEL_IN_DB='True'` in your env to enable this feature.",
			},
		};

		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			json: vi.fn().mockResolvedValue(backendError),
		} as any);

		global.fetch = mockFetch as any;

		try {
			await Networking.updateSSOSettings("token", { some: "setting" });
		} catch (error) {
			const thrownError = error as any;
			expect(thrownError).toBeInstanceOf(Error);
			expect(thrownError.message).toBe(backendError.detail.error);
			expect(thrownError.detail).toEqual(backendError.detail);
			expect(thrownError.rawError).toEqual(backendError);
		}

		expect(mockFetch).toHaveBeenCalledOnce();
	});
});

describe("daily activity helpers", () => {
	const startTime = new Date("2025-02-12T00:00:00.000Z");
	const endTime = new Date("2025-02-19T00:00:00.000Z");
	let currentFetch: typeof global.fetch;

	const setupSuccessfulFetch = () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ data: [] }),
		} as any);
		global.fetch = mockFetch as any;
		return mockFetch;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		currentFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = currentFetch;
	});

	it("appends tag list when tags argument is provided", async () => {
		const mockFetch = setupSuccessfulFetch();

		await Networking.tagDailyActivityCall("token", startTime, endTime, 2, ["alpha", "beta"]);

		expect(mockFetch).toHaveBeenCalledOnce();
		const calledUrl = mockFetch.mock.calls[0][0] as string;
		const parsed = new URL(calledUrl, "http://example.com");

		expect(parsed.pathname).toBe("/tag/daily/activity");
		expect(parsed.searchParams.get("tags")).toBe("alpha,beta");
	});

	it("always includes exclude_team_ids but only adds team_ids when given", async () => {
		const mockFetchWithoutTeams = setupSuccessfulFetch();

		await Networking.teamDailyActivityCall("token", startTime, endTime, 1, null);
		const urlWithoutTeams = new URL(mockFetchWithoutTeams.mock.calls[0][0] as string, "http://example.com");

		expect(urlWithoutTeams.searchParams.get("exclude_team_ids")).toBe("litellm-dashboard");
		expect(urlWithoutTeams.searchParams.has("team_ids")).toBe(false);

		const mockFetchWithTeams = setupSuccessfulFetch();
		await Networking.teamDailyActivityCall("token", startTime, endTime, 3, ["team-a", "team-b"]);
		const urlWithTeams = new URL(mockFetchWithTeams.mock.calls[0][0] as string, "http://example.com");

		expect(urlWithTeams.searchParams.get("team_ids")).toBe("team-a,team-b");
		expect(urlWithTeams.searchParams.get("exclude_team_ids")).toBe("litellm-dashboard");
	});
});

describe("UI config and public endpoints", () => {
	const originalFetch = global.fetch;

	const setupMockFetch = (responses: Array<{ url: string; data: any }>) => {
		const mockFetch = vi.fn().mockImplementation((url: string) => {
			const response = responses.find((r) => url.includes(r.url));
			if (response) {
				return Promise.resolve({
					ok: true,
					json: vi.fn().mockResolvedValue(response.data),
				} as any);
			}
			return Promise.resolve({
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			} as any);
		});
		global.fetch = mockFetch as any;
		return mockFetch;
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("should use proxyBaseURL and server_root_path for /public/providers/fields when server_root_path is defined", async () => {
		const uiConfig = {
			server_root_path: "/api/v1",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([
			{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
			{ url: "/public/providers/fields", data: [] },
		]);

		// First call getUiConfig to set up proxyBaseUrl
		await Networking.getUiConfig();

		// Then call the public endpoint
		await Networking.getProviderCreateMetadata();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const publicEndpointCall = mockFetch.mock.calls.find((call) =>
			(call[0] as string).includes("/public/providers/fields"),
		);
		expect(publicEndpointCall).toBeDefined();
		const calledUrl = publicEndpointCall![0] as string;
		expect(calledUrl).toBe("https://example.com/api/v1/public/providers/fields");
	});

	it("should use proxyBaseURL and server_root_path for /public/model_hub/info when server_root_path is defined", async () => {
		const uiConfig = {
			server_root_path: "/api/v1",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([
			{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
			{ url: "/public/model_hub/info", data: {} },
		]);

		await Networking.getUiConfig();
		await Networking.getPublicModelHubInfo();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const publicEndpointCall = mockFetch.mock.calls.find((call) =>
			(call[0] as string).includes("/public/model_hub/info"),
		);
		expect(publicEndpointCall).toBeDefined();
		const calledUrl = publicEndpointCall![0] as string;
		expect(calledUrl).toBe("https://example.com/api/v1/public/model_hub/info");
	});

	it("should use proxyBaseURL and server_root_path for /public/model_hub when server_root_path is defined", async () => {
		const uiConfig = {
			server_root_path: "/api/v1",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([
			{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
			{ url: "/public/model_hub", data: [] },
		]);

		await Networking.getUiConfig();
		await Networking.modelHubPublicModelsCall();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const publicEndpointCall = mockFetch.mock.calls.find(
			(call) => (call[0] as string).includes("/public/model_hub") && !(call[0] as string).includes("/info"),
		);
		expect(publicEndpointCall).toBeDefined();
		const calledUrl = publicEndpointCall![0] as string;
		expect(calledUrl).toBe("https://example.com/api/v1/public/model_hub");
	});

	it("should use proxyBaseURL and server_root_path for /public/agent_hub when server_root_path is defined", async () => {
		const uiConfig = {
			server_root_path: "/api/v1",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([
			{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
			{ url: "/public/agent_hub", data: [] },
		]);

		await Networking.getUiConfig();
		await Networking.agentHubPublicModelsCall();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const publicEndpointCall = mockFetch.mock.calls.find((call) => (call[0] as string).includes("/public/agent_hub"));
		expect(publicEndpointCall).toBeDefined();
		const calledUrl = publicEndpointCall![0] as string;
		expect(calledUrl).toBe("https://example.com/api/v1/public/agent_hub");
	});

	it("should use proxyBaseURL and server_root_path for /public/mcp_hub when server_root_path is defined", async () => {
		const uiConfig = {
			server_root_path: "/api/v1",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([
			{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
			{ url: "/public/mcp_hub", data: [] },
		]);

		await Networking.getUiConfig();
		await Networking.mcpHubPublicServersCall();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const publicEndpointCall = mockFetch.mock.calls.find((call) => (call[0] as string).includes("/public/mcp_hub"));
		expect(publicEndpointCall).toBeDefined();
		const calledUrl = publicEndpointCall![0] as string;
		expect(calledUrl).toBe("https://example.com/api/v1/public/mcp_hub");
	});

	it("should not include server_root_path when it is root path", async () => {
		const uiConfig = {
			server_root_path: "/",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([
			{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig },
			{ url: "/public/providers/fields", data: [] },
		]);

		await Networking.getUiConfig();
		await Networking.getProviderCreateMetadata();

		expect(mockFetch).toHaveBeenCalledTimes(2);
		const publicEndpointCall = mockFetch.mock.calls.find((call) =>
			(call[0] as string).includes("/public/providers/fields"),
		);
		expect(publicEndpointCall).toBeDefined();
		const calledUrl = publicEndpointCall![0] as string;
		expect(calledUrl).toBe("https://example.com/public/providers/fields");
	});

	it("should return UI config from getUiConfig", async () => {
		const uiConfig = {
			server_root_path: "/api/v1",
			proxy_base_url: "https://example.com",
		};

		const mockFetch = setupMockFetch([{ url: "/litellm/.well-known/litellm-ui-config", data: uiConfig }]);

		const result = await Networking.getUiConfig();

		expect(mockFetch).toHaveBeenCalledOnce();
		expect(result).toEqual(uiConfig);
		const configCall = mockFetch.mock.calls.find((call) =>
			(call[0] as string).includes("/litellm/.well-known/litellm-ui-config"),
		);
		expect(configCall).toBeDefined();
	});
});

describe("individualModelHealthCheckCall", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("should call /health with model_id query param so health checks run by deployment id", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				healthy_count: 1,
				unhealthy_count: 0,
				healthy_endpoints: [],
				unhealthy_endpoints: [],
			}),
		} as any);
		global.fetch = mockFetch as any;

		await Networking.individualModelHealthCheckCall("token-123", "deployment-abc-456");

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url] = mockFetch.mock.calls[0];
		const urlStr = typeof url === "string" ? url : (url as Request).url;
		expect(urlStr).toContain("health");
		const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);
		expect(parsed.searchParams.get("model_id")).toBe("deployment-abc-456");
		expect(parsed.searchParams.has("model")).toBe(false);
	});

	it("should encode model_id in URL", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				healthy_count: 0,
				unhealthy_count: 0,
				healthy_endpoints: [],
				unhealthy_endpoints: [],
			}),
		} as any);
		global.fetch = mockFetch as any;

		await Networking.individualModelHealthCheckCall("token", "id/with/slashes");

		const [url] = mockFetch.mock.calls[0];
		const parsed = typeof url === "string" ? new URL(url, "http://example.com") : new URL((url as Request).url);
		expect(parsed.searchParams.get("model_id")).toBe("id/with/slashes");
	});

	it("calls the all-deployment health endpoint once without model_id", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi
				.fn()
				.mockResolvedValue({ healthy_count: 0, unhealthy_count: 0, healthy_endpoints: [], unhealthy_endpoints: [] }),
		} as any);
		global.fetch = mockFetch as any;

		await Networking.allDeploymentHealthCheckCall("token");

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url] = mockFetch.mock.calls[0];
		const parsed = new URL(typeof url === "string" ? url : (url as Request).url, "http://example.com");
		expect(parsed.pathname).toMatch(/\/health$/);
		expect(parsed.searchParams.has("model_id")).toBe(false);
	});
});
