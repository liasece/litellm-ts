import { buildCliProxyQuotaRequests, normalizeCliProxyQuota } from "./CliProxyQuota";

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
