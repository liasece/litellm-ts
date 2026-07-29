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

	it("dashboardFetch 对显式 bearer 请求不混入 session cookie 或 CSRF", async () => {
		const cookieUtils = await import("@/utils/cookieUtils");
		vi.mocked(cookieUtils.getCookie).mockReturnValue("csrf-value");
		const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
		global.fetch = mockFetch as typeof global.fetch;
		const init = {
			method: "POST",
			headers: { Authorization: "Bearer test-key", "Content-Type": "application/json" },
		};

		await Networking.dashboardFetch("/compatibility-api", init);

		expect(mockFetch).toHaveBeenCalledWith("/compatibility-api", init);
		const [, forwardedInit] = mockFetch.mock.calls[0]!;
		expect(forwardedInit.credentials).toBeUndefined();
		expect(new Headers(forwardedInit.headers).get("x-litellm-csrf-token")).toBeNull();
	});

	it("keyInfoV1Call 应编码 query、仅携带 cookie 并只解析一次 JSON", async () => {
		const json = vi.fn().mockResolvedValue({ info: { key_alias: "logs-key" } });
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;
		const key = "hash+/=?& value";

		await expect(Networking.keyInfoV1Call("unused-access-token", key)).resolves.toEqual({
			info: { key_alias: "logs-key" },
		});

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0]!;
		expect(String(url)).toContain(`?key=${encodeURIComponent(key)}`);
		expect(init.credentials).toBe("include");
		const headers = new Headers(init.headers);
		expect(headers.get("Authorization")).toBeNull();
		expect(headers.get("x-api-key")).toBeNull();
		expect(headers.get("cookie-session")).toBeNull();
		expect(json).toHaveBeenCalledOnce();
	});

	it("keyInfoV1Call 401 应通知错误正文、抛错且不再解析 JSON", async () => {
		const NotificationsManager = (await import("./molecules/notifications_manager")).default;
		const text = vi.fn().mockResolvedValue("Invalid or revoked WebUI session");
		const json = vi.fn();
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: text, json: json } as any);

		await expect(Networking.keyInfoV1Call("unused-access-token", "target-hash")).rejects.toThrow(
			"Invalid or revoked WebUI session",
		);

		expect(text).toHaveBeenCalledOnce();
		expect(NotificationsManager.fromBackend).toHaveBeenCalledWith(
			"Failed to fetch key info - Invalid or revoked WebUI session",
		);
		expect(json).not.toHaveBeenCalled();
	});

	it("regenerateKeyCall 应调用已注册路由并在请求体中传递目标 token", async () => {
		const responseBody = { success: true, key: "sk-new", token: "new-token-hash" };
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue(responseBody),
		} as any);
		global.fetch = mockFetch as typeof global.fetch;

		await expect(
			Networking.regenerateKeyCall("unused-access-token", "old-token-hash", {
				duration: "30d",
				grace_period: "24h",
			}),
		).resolves.toEqual(responseBody);

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0]!;
		expect(String(url)).toMatch(/\/key\/regenerate$/);
		expect(String(url)).not.toContain("old-token-hash");
		expect(JSON.parse(String(init.body))).toEqual({
			duration: "30d",
			grace_period: "24h",
			token: "old-token-hash",
		});
		expect(init.credentials).toBe("include");
	});

	it("Playground session 应在网络边界移除 SDK 鉴权头并保留请求语义", async () => {
		const cookieUtils = await import("@/utils/cookieUtils");
		vi.mocked(cookieUtils.getCookie).mockReturnValue("csrf-value");
		const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
		global.fetch = mockFetch as typeof global.fetch;
		const controller = new AbortController();
		const request = new Request("https://example.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer cookie-session",
				"x-request-header": "request-value",
			},
		});

		await Networking.createPlaygroundFetch({ kind: "session" }, "openai")(request, {
			signal: controller.signal,
			headers: {
				"x-api-key": "cookie-session",
				"x-init-header": "init-value",
			},
		});

		expect(mockFetch).toHaveBeenCalledOnce();
		const [input, init] = mockFetch.mock.calls[0]!;
		expect(input).toBeInstanceOf(Request);
		expect((input as Request).url).toBe("https://example.com/v1/chat/completions");
		expect(init.credentials).toBe("include");
		expect(init.signal).toBe(controller.signal);
		const headers = new Headers(init.headers);
		expect(headers.get("Authorization")).toBeNull();
		expect(headers.get("x-api-key")).toBeNull();
		expect(headers.get("x-request-header")).toBe("request-value");
		expect(headers.get("x-init-header")).toBe("init-value");
		expect(headers.get("x-litellm-csrf-token")).toBe("csrf-value");
	});

	it("Playground custom key 应只发送协议对应鉴权头", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
		global.fetch = mockFetch as typeof global.fetch;

		await Networking.createPlaygroundFetch({ kind: "virtual-key", apiKey: "custom-key" }, "openai")(
			"https://example.com/v1/chat/completions",
			{ headers: { "x-api-key": "conflict" } },
		);
		await Networking.createPlaygroundFetch({ kind: "virtual-key", apiKey: "custom-key" }, "anthropic")(
			"https://example.com/v1/messages",
			{ headers: { Authorization: "Bearer conflict" } },
		);

		const openAIHeaders = new Headers(mockFetch.mock.calls[0]![1].headers);
		expect(openAIHeaders.get("Authorization")).toBe("Bearer custom-key");
		expect(openAIHeaders.get("x-api-key")).toBeNull();
		const anthropicHeaders = new Headers(mockFetch.mock.calls[1]![1].headers);
		expect(anthropicHeaders.get("x-api-key")).toBe("custom-key");
		expect(anthropicHeaders.get("Authorization")).toBeNull();
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

	it("解析 web-search override 候选数组", async () => {
		const candidates = [
			{ model_name: "logical-model", type: "model" as const },
			{ model_name: "search-alias", type: "alias" as const },
		];
		global.fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(candidates) } as any);

		await expect(Networking.getRoutableModelCandidatesCall("token")).resolves.toEqual(candidates);
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

describe("adminTopKeysCall", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("requests all global spend keys without a limit query", async () => {
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue([]) } as any);
		global.fetch = mockFetch as typeof global.fetch;

		await Networking.adminTopKeysCall("token");

		expect(String(mockFetch.mock.calls[0]![0])).toMatch(/\/global\/spend\/keys$/);
	});
});

describe("sessionSpendLogsCall", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("编码 session ID，仅携带 cookie，成功 JSON 只解析一次", async () => {
		const json = vi.fn().mockResolvedValue({ data: [] });
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;
		const sessionId = "trace+/=?& value";

		await expect(Networking.sessionSpendLogsCall("unused-token", sessionId)).resolves.toEqual({ data: [] });

		const [url, init] = mockFetch.mock.calls[0]!;
		expect(String(url)).toContain(`session_id=${encodeURIComponent(sessionId)}`);
		expect(init.credentials).toBe("include");
		const headers = new Headers(init.headers);
		expect(headers.get("Authorization")).toBeNull();
		expect(headers.get("x-api-key")).toBeNull();
		expect(headers.get("cookie-session")).toBeNull();
		expect(json).toHaveBeenCalledOnce();
	});

	it("Session group 参数包含类型并完整 URL 编码 ID", async () => {
		const json = vi.fn().mockResolvedValue({ data: [] });
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;
		const groupId = "user_device_account__session_123e4567-e89b-12d3-a456-426614174000 +/&";

		await Networking.sessionSpendLogsCall("unused-token", {
			type: "claude_code_user_id",
			id: groupId,
		});

		const parsed = new URL(String(mockFetch.mock.calls[0]![0]), "http://example.com");
		expect(parsed.searchParams.get("session_group_type")).toBe("claude_code_user_id");
		expect(parsed.searchParams.get("session_group_id")).toBe(groupId);
		expect(parsed.searchParams.has("session_id")).toBe(false);
	});

	it("可选分页参数映射为 page 和 page_size，旧调用不附加分页参数", async () => {
		const json = vi.fn().mockResolvedValue({ data: [] });
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;

		await Networking.sessionSpendLogsCall("unused-token", "session-A");
		await Networking.sessionSpendLogsCall("unused-token", "session-A", 2, 100);

		const legacyUrl = new URL(String(mockFetch.mock.calls[0]![0]), "http://example.com");
		expect(legacyUrl.searchParams.has("page")).toBe(false);
		expect(legacyUrl.searchParams.has("page_size")).toBe(false);
		const pagedUrl = new URL(String(mockFetch.mock.calls[1]![0]), "http://example.com");
		expect(pagedUrl.searchParams.get("page")).toBe("2");
		expect(pagedUrl.searchParams.get("page_size")).toBe("100");
	});

	it("options 参数透传显式 team scope、snapshot、cursor、首屏 total 和按需正文，且不破坏旧分页调用", async () => {
		const json = vi.fn().mockResolvedValue({ data: [] });
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;

		await Networking.sessionSpendLogsCall("unused-token", "session-A", {
			pageSize: 100,
			teamId: "team scope +/&",
			snapshot: "snapshot +/&",
			cursor: "cursor +/&",
			knownTotal: 321,
			includeContent: true,
		});

		const url = new URL(String(mockFetch.mock.calls[0]![0]), "http://example.com");
		expect(url.searchParams.get("page_size")).toBe("100");
		expect(url.searchParams.get("team_id")).toBe("team scope +/&");
		expect(url.searchParams.get("snapshot")).toBe("snapshot +/&");
		expect(url.searchParams.get("cursor")).toBe("cursor +/&");
		expect(url.searchParams.get("known_total")).toBe("321");
		expect(url.searchParams.get("include_content")).toBe("true");
		expect(url.searchParams.has("page")).toBe(false);
	});

	it("失败日志不输出完整敏感 session ID", async () => {
		const sessionId = "sensitive-session-id-that-must-not-be-logged";
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		global.fetch = vi.fn().mockRejectedValue(new Error(`network failure for ${sessionId}`));

		await expect(Networking.sessionSpendLogsCall("unused-token", sessionId)).rejects.toThrow("network failure");
		expect(consoleError.mock.calls.flat().map(String).join(" ")).not.toContain(sessionId);
		consoleError.mockRestore();
	});

	it("JSON 错误正文提取后端 message，正文只读取一次", async () => {
		const text = vi.fn().mockResolvedValue(JSON.stringify({ message: "Session lookup failed" }));
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: text } as any);

		await expect(Networking.sessionSpendLogsCall("unused-token", "session-A")).rejects.toThrow("Session lookup failed");
		expect(text).toHaveBeenCalledOnce();
	});

	it("HTML 404 转为稳定 HTTP 错误，不泄露 HTML 或产生 JSON SyntaxError", async () => {
		const html = "<!DOCTYPE html><html><body>Cannot GET /spend/logs/session/ui</body></html>";
		const text = vi.fn().mockResolvedValue(html);
		global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: text } as any);

		let thrown: Error | undefined;
		try {
			await Networking.sessionSpendLogsCall("unused-token", "session-A");
		} catch (error) {
			thrown = error as Error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(thrown?.message).toContain("404");
		expect(thrown?.message).not.toContain("<!DOCTYPE html>");
		expect(thrown?.message).not.toContain("Unexpected token");
		expect(text).toHaveBeenCalledOnce();
	});
});

describe("sessionTimelineCall", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("只调用独立时间线接口，并完整编码 Session group 与 team scope", async () => {
		const responseBody = {
			data: [],
			summary: {
				request_count: 0,
				event_count: 0,
				total_spend: 0,
				total_tokens: 0,
				duration_seconds: 0,
				start_time: null,
				end_time: null,
			},
		};
		const json = vi.fn().mockResolvedValue(responseBody);
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;

		await expect(
			Networking.sessionTimelineCall(
				"unused-token",
				{ type: "session_id", id: "session +/&" },
				"team +/&",
			),
		).resolves.toEqual(responseBody);

		const url = new URL(String(mockFetch.mock.calls[0]![0]), "http://example.com");
		expect(url.pathname).toBe("/spend/logs/session/timeline");
		expect(url.searchParams.get("session_group_type")).toBe("session_id");
		expect(url.searchParams.get("session_group_id")).toBe("session +/&");
		expect(url.searchParams.get("team_id")).toBe("team +/&");
		expect(url.searchParams.has("include_content")).toBe(false);
		expect(json).toHaveBeenCalledOnce();
	});
});

describe("uiSpendLogDetailsBatchCall", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("通过一次 POST 批量请求日志详情", async () => {
		const json = vi.fn().mockResolvedValue({
			data: [
				{ request_id: "req-1", messages: ["first"] },
				{ request_id: "req-2", messages: ["second"] },
			],
		});
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: json } as any);
		global.fetch = mockFetch as typeof global.fetch;
		const requests = [
			{ request_id: "req-1", start_date: "2026-07-28 08:00:00" },
			{ request_id: "req-2", start_date: "2026-07-28 08:01:00" },
		];

		await expect(Networking.uiSpendLogDetailsBatchCall("unused-token", requests)).resolves.toEqual({
			data: [
				{ request_id: "req-1", messages: ["first"] },
				{ request_id: "req-2", messages: ["second"] },
			],
		});

		const [url, init] = mockFetch.mock.calls[0]!;
		expect(String(url)).toMatch(/\/spend\/logs\/ui\/batch$/);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({ requests });
		expect(json).toHaveBeenCalledOnce();
	});
});

describe("credential networking", () => {
	const originalFetch = global.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("uses the canonical encoded model_id query", async () => {
		const json = vi.fn().mockResolvedValue({ data: [] });
		global.fetch = vi.fn().mockResolvedValue({ ok: true, json } as any);
		const modelId = "model/a?version=1&region=eu";

		await Networking.modelInfoV1Call("unused-token", modelId);

		const [url] = vi.mocked(global.fetch).mock.calls[0]!;
		expect(String(url)).toContain(`model_id=${encodeURIComponent(modelId)}`);
		expect(String(url)).not.toContain("litellm_model_id=");
	});

	it("encodes credential path segments", async () => {
		const json = vi.fn().mockResolvedValue({ success: true });
		global.fetch = vi.fn().mockResolvedValue({ ok: true, json } as any);
		const credentialName = "team/a credential?";
		const modelId = "model/a credential?";

		await Networking.credentialGetCall("unused-token", credentialName, null);
		await Networking.credentialGetCall("unused-token", null, modelId);
		await Networking.credentialDeleteCall("unused-token", credentialName);
		await Networking.credentialUpdateCall("unused-token", credentialName, { credential_values: {} });

		const urls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
		expect(urls.some((url) => url.endsWith(`/credentials/by_name/${encodeURIComponent(credentialName)}`))).toBe(true);
		expect(urls.some((url) => url.endsWith(`/credentials/by_model/${encodeURIComponent(modelId)}`))).toBe(true);
		expect(urls.some((url) => url.endsWith(`/credentials/${encodeURIComponent(credentialName)}`))).toBe(true);
	});

	it("never logs credential secrets and reports operation-specific errors", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const secret = "super-secret-api-key";
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: vi.fn().mockResolvedValue({ error: { message: "Credential rejected" } }),
		} as any);

		await expect(
			Networking.credentialCreateCall("unused-token", {
				credential_name: "credential",
				credential_values: { api_key: secret },
			}),
		).rejects.toThrow("Credential rejected");
		await expect(
			Networking.credentialUpdateCall("unused-token", "credential", { credential_values: { api_key: secret } }),
		).rejects.toThrow("Credential rejected");

		expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining(secret), expect.anything());
		expect(consoleError.mock.calls.flat().map(String).join(" ")).not.toContain("Failed to create key");
		consoleLog.mockRestore();
		consoleError.mockRestore();
	});

	it("preserves plain-text credential errors", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 409,
			text: vi.fn().mockResolvedValue("Credential already exists"),
		} as any);

		await expect(Networking.credentialCreateCall("unused-token", { credential_name: "duplicate" })).rejects.toThrow(
			"Credential already exists",
		);
	});

	it("does not log model patch payloads, responses, or connection secrets", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const secret = "never-log-this-secret";
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({ api_key: secret }),
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: { get: vi.fn().mockReturnValue("application/json") },
				json: vi.fn().mockResolvedValue({ status: "success" }),
			} as any);

		await Networking.modelPatchUpdateCall("unused-token", { litellm_params: { api_key: secret } }, "model/id");
		await Networking.testConnectionRequest("unused-token", { api_key: secret }, {}, "chat");

		expect(consoleLog.mock.calls.flat().map(String).join(" ")).not.toContain(secret);
		consoleLog.mockRestore();
	});
});
