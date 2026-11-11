import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccount } from "../types";
import { executeQuotaRequests, quotaForAccount } from "./quota";

/** 一次被记录的请求。 */
interface RecordedCall {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: unknown;
}

/** 桩响应。 */
interface StubResponse {
	/** HTTP 状态；缺省 200。 */
	readonly status?: number;
	/** 响应体；字符串原样返回，其余 JSON 序列化。 */
	readonly body?: unknown;
}

/** 按调用顺序返回桩响应的 fetch。 */
function stubFetch(responses: readonly StubResponse[]): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
	const calls: RecordedCall[] = [];
	const fetchImpl = (async (input: unknown, init?: RequestInit): Promise<Response> => {
		const response = responses[calls.length];
		calls.push({
			url: String(input),
			method: init?.method ?? "GET",
			headers: { ...((init?.headers ?? {}) as Record<string, string>) },
			body: init?.body,
		});
		if (!response) {
			throw new TypeError(`unexpected request ${calls.length}`);
		}
		const status = response.status ?? 200;
		return {
			ok: status >= 200 && status < 300,
			status: status,
			text: async (): Promise<string> =>
				typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {}),
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { calls: calls, fetchImpl: fetchImpl };
}

/** 请求头里不应再出现占位符或明文旧凭据。 */
function expectSubstituted(call: RecordedCall, credential: string): void {
	expect(call.headers["Authorization"]).toBe(`Bearer ${credential}`);
	expect(JSON.stringify(call.headers)).not.toContain("$TOKEN$");
	expect(call.url).not.toContain(credential);
}

describe("原生订阅额度查询", () => {
	it("Codex：替换 $TOKEN$、只发一次 allowlist 请求并归一化窗口", async () => {
		const { calls, fetchImpl } = stubFetch([
			{
				body: {
					plan_type: "plus",
					rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_after_seconds: 600 } },
				},
			},
		]);
		const quota = await executeQuotaRequests("codex", { chatgpt_account_id: "acc-1", access_token: "stale" }, "codex-token", fetchImpl);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://chatgpt.com/backend-api/wham/usage");
		expectSubstituted(calls[0]!, "codex-token");
		expect(calls[0]?.headers["Chatgpt-Account-Id"]).toBe("acc-1");
		expect(JSON.stringify(calls[0]?.headers)).not.toContain("stale");
		expect(quota.provider).toBe("codex");
		expect(quota.plan).toBe("plus");
		expect(quota.windows[0]).toMatchObject({ id: "codex-primary", label: "Codex · 5 小时", used_percent: 25, remaining_percent: 75 });
		expect(Number.isNaN(Date.parse(quota.fetched_at))).toBe(false);
	});

	it("Claude：profile 失败不阻断 usage 结果", async () => {
		const { calls, fetchImpl } = stubFetch([
			{ body: { five_hour: { utilization: 20, resets_at: "2026-08-01T00:00:00Z" } } },
			{ status: 500, body: "upstream error" },
		]);
		const quota = await executeQuotaRequests("claude", {}, "claude-token", fetchImpl);

		expect(calls.map((call) => call.url)).toEqual([
			"https://api.anthropic.com/api/oauth/usage",
			"https://api.anthropic.com/api/oauth/profile",
		]);
		expect(quota.provider).toBe("claude");
		expect(quota.plan).toBeNull();
		expect(quota.windows[0]).toMatchObject({ label: "5 小时", used_percent: 20, remaining_percent: 80 });
	});

	it("Kimi 与 xAI：按 provider 分派到各自的归一化", async () => {
		const kimi = await executeQuotaRequests(
			"kimi",
			{},
			"kimi-token",
			stubFetch([{ body: { limits: [{ detail: { used: 10, limit: 100 } }] } }]).fetchImpl,
		);
		expect(kimi.provider).toBe("kimi");
		expect(kimi.windows[0]).toMatchObject({ id: "limit-0", used_percent: 10, remaining_percent: 90 });

		const xai = await executeQuotaRequests(
			"xai",
			{ user_id: "user-1" },
			"xai-token",
			stubFetch([
				{ body: { config: { creditUsagePercent: 30, currentPeriod: { type: "weekly", end: "2026-11-17T00:00:00Z" } } } },
				{ body: { config: {} } },
			]).fetchImpl,
		);
		expect(xai.provider).toBe("xai");
		expect(xai.windows[0]).toMatchObject({ id: "billing-0", label: "weekly", used_percent: 30, remaining_percent: 70 });
	});

	it("Antigravity：同一 fallback_group 成功后跳过后续区域域名", async () => {
		const { calls, fetchImpl } = stubFetch([
			{ status: 500, body: "region down" },
			{ body: { groups: [{ displayName: "Gemini", buckets: [{ bucketId: "pro", displayName: "Pro", remainingFraction: 0.65 }] }] } },
		]);
		const quota = await executeQuotaRequests("antigravity", { project_id: "proj-1" }, "ag-token", fetchImpl);

		expect(calls.map((call) => call.url)).toEqual([
			"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
			"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
		]);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.body).toBe(JSON.stringify({ project: "proj-1" }));
		expect(quota.windows[0]).toMatchObject({ id: "pro", used_percent: 35, remaining_percent: 65 });
	});

	it("Antigravity 缺少 project_id 时在发请求前失败", async () => {
		const { calls, fetchImpl } = stubFetch([{ body: {} }]);
		await expect(executeQuotaRequests("antigravity", {}, "ag-token", fetchImpl)).rejects.toMatchObject({ statusCode: 400 });
		expect(calls).toHaveLength(0);
	});

	it("CommandCode：额度、套餐与月度窗口按账户接口拼装后再归一化", async () => {
		const { calls, fetchImpl } = stubFetch([
			{
				body: {
					credits: { monthlyCredits: 52.5, purchasedCredits: 0 },
					windowLimits: {
						limited: true,
						fiveHour: { used: 10, cap: 100, exceeded: false, resetAt: 1793527200000 },
						weekly: { used: 40, cap: 100 },
					},
				},
			},
			{ body: { success: true, data: { planId: "individual-goat", status: "active", currentPeriodEnd: "2026-12-01T00:00:00.000Z" } } },
			{ body: { success: true, user: { email: "ops@example.com" }, org: { login: "jtllab" } } },
		]);
		const quota = await executeQuotaRequests("commandcode", { auth_index: "cc-1" }, "cc-key", fetchImpl);

		expect(calls.map((call) => call.url)).toEqual([
			"https://api.commandcode.ai/alpha/billing/credits",
			"https://api.commandcode.ai/alpha/billing/subscriptions",
			"https://api.commandcode.ai/alpha/whoami?limits=1",
		]);
		expect(calls[0]?.headers["Authorization"]).toBe("Bearer cc-key");
		expect(quota.provider).toBe("commandcode");
		expect(quota.plan).toBe("GOAT");
		expect(quota.windows.map((window) => window.label)).toEqual(["5 小时", "周", "月"]);
		expect(quota.windows[0]).toMatchObject({ used_percent: 10, remaining_percent: 90, resets_at: "2026-11-01T10:00:00.000Z" });
		expect(quota.windows[2]).toMatchObject({ used_percent: 25, remaining_percent: 75 });
		expect(quota.balances[0]).toMatchObject({ label: "剩余计划额度", used: 17.5, limit: 70, unit: "$" });
		expect(quota.subscription_expires_at).toBe("2026-12-01T00:00:00.000Z");
	});

	it("CommandCode：套餐与身份接口失败时仍返回窗口数据", async () => {
		const { fetchImpl } = stubFetch([
			{
				body: {
					credits: { monthlyCredits: 52.5 },
					windowLimits: { fiveHour: { used: 5, cap: 50 }, weekly: { used: 1, cap: 10 } },
				},
			},
			{ status: 500, body: "subscription down" },
			{ status: 500, body: "whoami down" },
		]);
		const quota = await executeQuotaRequests("commandcode", {}, "cc-key", fetchImpl);

		expect(quota.plan).toBeNull();
		expect(quota.windows.map((window) => window.id)).toEqual(["commandcode:five_hour", "commandcode:weekly"]);
		expect(quota.balances[0]).toMatchObject({ label: "剩余额度", limit: 52.5 });
	});

	it("CommandCode：额度接口失败与空额度都归一化为 503", async () => {
		await expect(
			executeQuotaRequests("commandcode", {}, "cc-key", stubFetch([{ status: 401, body: "denied" }]).fetchImpl),
		).rejects.toMatchObject({ statusCode: 503 });
		await expect(
			executeQuotaRequests("commandcode", {}, "cc-key", stubFetch([{ status: 401 }]).fetchImpl),
		).rejects.toThrow("commandcode 订阅额度查询失败: HTTP 401");

		const { fetchImpl } = stubFetch([{ body: {} }, { body: {} }, { body: {} }]);
		await expect(executeQuotaRequests("commandcode", {}, "cc-key", fetchImpl)).rejects.toThrow("CommandCode 未返回可展示的订阅额度");
	});

	it("OpenCode Go：把 /usage 窗口换算成剩余比例后归一化", async () => {
		const { calls, fetchImpl } = stubFetch([
			{ body: { usage: { rolling: { percent: 25, resetsAt: "2026-11-10T09:00:00Z" }, weekly: { percent: 40.5 }, monthly: { percent: 10 } } } },
		]);
		const quota = await executeQuotaRequests("opencode-go", {}, "oc-key", fetchImpl);

		expect(calls.map((call) => call.url)).toEqual(["https://opencode.ai/zen/go/v1/usage"]);
		expectSubstituted(calls[0]!, "oc-key");
		expect(quota.provider).toBe("opencode-go");
		expect(quota.plan).toBe("Go");
		expect(quota.windows.map((window) => window.id)).toEqual(["opencode-go:rolling", "opencode-go:weekly", "opencode-go:monthly"]);
		expect(quota.windows[0]).toMatchObject({ label: "5 小时", used_percent: 25, remaining_percent: 75, resets_at: "2026-11-10T09:00:00.000Z" });
		expect(quota.windows[1]).toMatchObject({ label: "周", used_percent: 40.5, remaining_percent: 59.5 });
	});

	it("OpenCode Go：没有可读窗口或比例越界时归一化为 503", async () => {
		await expect(
			executeQuotaRequests("opencode-go", {}, "oc-key", stubFetch([{ body: { usage: {} } }]).fetchImpl),
		).rejects.toThrow("OpenCode Go 未返回可展示的订阅额度");
		await expect(
			executeQuotaRequests("opencode-go", {}, "oc-key", stubFetch([{ body: { usage: { rolling: { percent: 150 } } } }]).fetchImpl),
		).rejects.toThrow("OpenCode Go 未返回可展示的订阅额度");
		await expect(executeQuotaRequests("opencode-go", {}, "oc-key", stubFetch([{ body: {} }]).fetchImpl)).rejects.toThrow(
			"OpenCode Go 额度响应无效",
		);
	});

	it("缺少凭据、非法 JSON、空响应与未知 provider 都有明确错误", async () => {
		const noCredential = stubFetch([{ body: {} }]);
		await expect(executeQuotaRequests("codex", {}, "   ", noCredential.fetchImpl)).rejects.toMatchObject({ statusCode: 503 });
		expect(noCredential.calls).toHaveLength(0);

		await expect(executeQuotaRequests("codex", {}, "token", stubFetch([{ body: "{oops" }]).fetchImpl)).rejects.toThrow(
			"codex 订阅额度响应无效",
		);
		await expect(executeQuotaRequests("codex", {}, "token", stubFetch([{ body: "" }]).fetchImpl)).rejects.toThrow(
			"codex 订阅额度响应为空",
		);
		await expect(executeQuotaRequests("gemini", {}, "token", stubFetch([{ body: {} }]).fetchImpl)).rejects.toMatchObject({
			statusCode: 400,
		});
	});

	it("网络失败转换成 503 且不回显凭据", async () => {
		const fetchImpl = (async (): Promise<Response> => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		const failure = await executeQuotaRequests("kimi", {}, "secret-token", fetchImpl).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(ApiError);
		expect((failure as ApiError).statusCode).toBe(503);
		expect((failure as ApiError).message).toContain("kimi 订阅额度查询失败");
		expect((failure as ApiError).message).not.toContain("secret-token");
	});

	it("quotaForAccount 使用账号 raw 元数据与传入凭据", async () => {
		const account: SubscriptionAccount = {
			id: "acc-1",
			source: "codex",
			fileName: "codex-acc-1.json",
			path: "/var/lib/litellm/cliproxy/auths/codex-acc-1.json",
			disabled: false,
			weight: 1,
			raw: { chatgpt_account_id: "acc-1" },
		};
		const { calls, fetchImpl } = stubFetch([{ body: { rate_limit: { primary_window: { used_percent: 12 } } } }]);
		const quota = await quotaForAccount("codex", account, "account-token", fetchImpl);

		expect(calls[0]?.headers["Authorization"]).toBe("Bearer account-token");
		expect(calls[0]?.headers["Chatgpt-Account-Id"]).toBe("acc-1");
		expect(quota.provider).toBe("codex");
		expect(quota.windows[0]).toMatchObject({ used_percent: 12, remaining_percent: 88 });
	});
});
