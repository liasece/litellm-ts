import { ApiError } from "../core/api/ApiError";
import {
	buildCliProxyQuotaRequests,
	normalizeCliProxyCommandCodeQuota,
	normalizeCliProxyPluginQuota,
	normalizeCliProxyQuota,
} from "./CliProxyQuota";

describe("CLIProxy subscription quota normalization", () => {
	it("converts Codex used percentages to remaining percentages and classifies rolling windows", () => {
		const now = Date.parse("2026-07-31T00:00:00.000Z");
		const quota = normalizeCliProxyQuota(
			"codex",
			[
				{
					id: "usage",
					body: {
						plan_type: "plus",
						rate_limit: {
							primary_window: {
								used_percent: 25,
								limit_window_seconds: 18_000,
								reset_at: 1_785_465_600,
							},
							secondary_window: {
								used_percent: "40",
								limit_window_seconds: 604_800,
								reset_after_seconds: 600,
							},
						},
					},
				},
			],
			{ chatgpt_subscription_active_until: "2026-12-31T00:00:00Z" },
			now,
		);

		expect(quota.plan).toBe("plus");
		expect(quota.subscription_expires_at).toBe("2026-12-31T00:00:00.000Z");
		expect(quota.windows).toEqual([
			expect.objectContaining({
				label: "Codex · 5 小时",
				used_percent: 25,
				remaining_percent: 75,
				resets_at: "2026-07-31T02:40:00.000Z",
			}),
			expect.objectContaining({
				label: "Codex · 7 天",
				used_percent: 40,
				remaining_percent: 60,
				resets_at: "2026-07-31T00:10:00.000Z",
			}),
		]);
	});

	it("builds only allowlisted Codex requests with token substitution", () => {
		expect(
			buildCliProxyQuotaRequests("codex", {
				chatgpt_account_id: "account-1",
				access_token: "must-not-be-forwarded",
			}),
		).toEqual([
			expect.objectContaining({
				method: "GET",
				url: "https://chatgpt.com/backend-api/wham/usage",
				header: expect.objectContaining({
					Authorization: "Bearer $TOKEN$",
					"Chatgpt-Account-Id": "account-1",
				}),
			}),
		]);
		expect(JSON.stringify(buildCliProxyQuotaRequests("codex", {}))).not.toContain("must-not-be-forwarded");
	});

	it("uses Codex account metadata nested in the managed auth-file id_token", () => {
		const authFile = {
			id_token: {
				chatgpt_account_id: "managed-account",
				plan_type: "pro",
				chatgpt_subscription_active_until: "2026-12-31T00:00:00Z",
			},
		};
		const request = buildCliProxyQuotaRequests("codex", authFile)[0];
		expect(request?.header["Chatgpt-Account-Id"]).toBe("managed-account");
		const quota = normalizeCliProxyQuota(
			"codex",
			[
				{
					id: "usage",
					body: {
						rate_limit: { primary_window: { used_percent: 70, limit_window_seconds: 604800 } },
					},
				},
			],
			authFile,
		);
		expect(quota).toMatchObject({
			plan: "pro",
			subscription_expires_at: "2026-12-31T00:00:00.000Z",
			windows: [expect.objectContaining({ remaining_percent: 30 })],
		});
	});

	it("keeps legacy Codex metadata precedence and ignores non-object id_token values", () => {
		expect(
			buildCliProxyQuotaRequests("codex", {
				chatgpt_account_id: "legacy-account",
				id_token: { chatgpt_account_id: "nested-account" },
			})[0]?.header["Chatgpt-Account-Id"],
		).toBe("legacy-account");
		for (const idToken of [null, "opaque-token", [], 42]) {
			expect(buildCliProxyQuotaRequests("codex", { id_token: idToken })[0]?.header["Chatgpt-Account-Id"]).toBeUndefined();
		}
	});

	it("normalizes Claude utilization and Antigravity remaining fractions without reversing their meaning", () => {
		const claude = normalizeCliProxyQuota(
			"claude",
			[{ id: "usage", body: { five_hour: { utilization: 20, resets_at: "2026-08-01T00:00:00Z" } } }],
			{},
		);
		const antigravity = normalizeCliProxyQuota(
			"antigravity",
			[
				{
					id: "usage-0",
					body: {
						groups: [
							{
								displayName: "Gemini",
								buckets: [{ bucketId: "pro", displayName: "Pro", remainingFraction: 0.65 }],
							},
						],
					},
				},
			],
			{},
		);

		expect(claude.windows[0]).toMatchObject({ used_percent: 20, remaining_percent: 80 });
		expect(antigravity.windows[0]).toMatchObject({ used_percent: 35, remaining_percent: 65 });
	});
});

describe("CLIProxy plugin quota normalization", () => {
	it("maps generic plugin buckets to display windows", () => {
		const quota = normalizeCliProxyPluginQuota("opencode-go", {
			subscription: { plan: "Go" },
			groups: [
				{
					displayName: "OpenCode Go",
					buckets: [
						{ window: "rolling", remainingFraction: 0.75, resetTime: "2026-10-29T09:00:00Z" },
						{ window: "monthly", remaining_fraction: 0.4, reset_time: "2026-11-01T00:00:00Z" },
					],
				},
			],
		});

		expect(quota?.plan).toBe("Go");
		expect(quota?.windows).toEqual([
			expect.objectContaining({
				id: "opencode-go:rolling",
				label: "5 小时",
				used_percent: 25,
				remaining_percent: 75,
				resets_at: "2026-10-29T09:00:00.000Z",
			}),
			expect.objectContaining({ id: "opencode-go:monthly", label: "月", remaining_percent: 40 }),
		]);
	});

	it("returns null when no readable bucket is present", () => {
		const unnamed = normalizeCliProxyPluginQuota("opencode-go", {
			groups: [{ buckets: [{ remainingFraction: 1 }] }],
		});
		expect(unnamed?.windows[0]?.id).toBe("opencode-go:bucket-1");
		expect(normalizeCliProxyPluginQuota("opencode-go", { groups: [] })).toBeNull();
	});
});

describe("CLIProxy CommandCode quota normalization", () => {
	it("maps account credits and rolling windows", () => {
		const quota = normalizeCliProxyCommandCodeQuota(
			{
				cards: [
					{
						key_id: "cc-1",
						status: "active",
						usage: {
							plan: "GOAT",
							plan_credits: 70,
							credits_left: 52.5,
							five_hour: { percent: 10, resets_at: "2026-11-01T06:00:00Z" },
							weekly: { percent: 25 },
							month: { percent: 25, resets_at: "2026-12-01T00:00:00Z" },
						},
					},
				],
			},
			"cc-1",
		);

		expect(quota?.plan).toBe("GOAT");
		expect(quota?.windows.map((window) => window.label)).toEqual(["5 小时", "周", "月"]);
		expect(quota?.windows[0]).toMatchObject({ used_percent: 10, remaining_percent: 90 });
		expect(quota?.balances[0]).toMatchObject({ label: "剩余计划额度", used: 17.5, limit: 70, unit: "$" });
		expect(quota?.subscription_expires_at).toBe("2026-12-01T00:00:00.000Z");
	});

	it("surfaces the plugin account error", () => {
		expect(() => normalizeCliProxyCommandCodeQuota({ cards: [{ key_id: "cc-1", error: "account request failed" }] }, "cc-1")).toThrow(
			ApiError,
		);
	});

	it("accepts the single-card response returned for a key_id query", () => {
		const quota = normalizeCliProxyCommandCodeQuota(
			{ key_id: "cc-1", usage: { plan: "GOAT", credits_left: 70, five_hour: { percent: 0 } } },
			"cc-1",
		);

		expect(quota?.plan).toBe("GOAT");
		expect(quota?.windows).toHaveLength(1);
	});

	it("returns null when no card is present", () => {
		expect(normalizeCliProxyCommandCodeQuota({ cards: [] }, "cc-1")).toBeNull();
	});
});
