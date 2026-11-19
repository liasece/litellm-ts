import { describe, expect, it } from "vitest";
import { groupQuotaAccountRows, lowestRemainingPercent, quotaAccountRows, quotaUrgency, subscriptionBalance } from "./UsageQuotaRowsLogic";
import type { BuiltInQuotaAccount, UpstreamAccount } from "../api/UpstreamQuotaApi";

const window = { id: "5h", label: "5 小时", remaining_percent: 72, resets_at: "2026-11-20T00:00:00Z" };
const quota = {
	provider: "claude",
	plan: "Max 20x",
	subscription_expires_at: "2026-12-06T03:43:59Z",
	windows: [window],
	balances: [{ label: "剩余计划额度", used: 0.01, limit: 35, unit: "USD" }],
	email: "quota@example.com",
	fetched_at: "2026-11-19T02:46:37Z",
};

describe("quotaAccountRows", () => {
	it("内置 key 行带类型标签、模型与已格式化的余额", () => {
		const provider: BuiltInQuotaAccount = {
			id: "deepseek-1",
			provider: "deepseek",
			label: "DeepSeek 主账号",
			models: ["deepseek-chat"],
			account_kind: "pay_as_you_go",
			plan: null,
			subscription_expires_at: null,
			windows: [],
			balances: [
				{ label: "余额", remaining: 12.5, unit: "CNY", details: ["赠金 2", "充值 10.5"] },
				{ label: "重置次数", remaining: 3, unit: "次可用" },
			],
			fetched_at: "2026-11-19T02:46:37Z",
		};
		const [row] = quotaAccountRows({ providers: [provider], accounts: [], quotas: {}, formatUsd: (v) => "$" + v.toFixed(2) });
		expect(row).toMatchObject({
			key: "builtin-deepseek-1",
			testid: "builtin-provider-quota-deepseek",
			provider: "deepseek",
			name: "DeepSeek 主账号",
			models: ["deepseek-chat"],
			kind: "Pay-as-you-go key",
			loading: false,
		});
		expect(row.balances.map((balance) => balance.remaining)).toEqual(["12.50 CNY", "3.00 次可用"]);
		// 没有额度窗口（按量付费 key）就没有可判断的紧迫程度，页面上不画点。
		expect(row).toMatchObject({ urgency: null, lowestPercent: null });
		expect(row.balances[0].details).toEqual(["赠金 2", "充值 10.5"]);
	});

	it("订阅账号行取额度里的邮箱、计划与到期时间，余额按上限减已用折算", () => {
		const account: UpstreamAccount = { auth_index: "7", filename: "claude-7.json", provider: "anthropic", email: null };
		const [row] = quotaAccountRows({
			providers: [],
			accounts: [account],
			quotas: { "7": { status: "success", data: quota } },
			formatUsd: (v) => "$" + v.toFixed(2),
		});
		expect(row).toMatchObject({
			key: "account-7",
			provider: "claude",
			label: "Claude",
			name: "quota@example.com",
			kind: "Subscription account",
			plan: "Max 20x",
			expires: "2026-12-06T03:43:59Z",
			loading: false,
			error: null,
		});
		expect(row.windows).toEqual([window]);
		expect(row).toMatchObject({ urgency: "healthy", lowestPercent: 72 });
		expect(row.balances).toEqual([{ label: "剩余计划额度", remaining: "$34.99 remaining" }]);
	});

	it("没有邮箱时退回文件名，加载与失败只落在这一行上", () => {
		const accounts: UpstreamAccount[] = [
			{ auth_index: "a", filename: "claude-a.json", provider: "claude", email: null },
			{ auth_index: "b", filename: "claude-b.json", provider: "claude", email: null },
		];
		const [loading, failed] = quotaAccountRows({
			providers: [],
			accounts,
			quotas: { a: { status: "loading" }, b: { status: "error", error: "401 unauthorized" } },
			formatUsd: (v) => String(v),
		});
		expect(loading.name).toBe("claude-a.json");
		expect(loading).toMatchObject({ loading: true, error: null, updated: null });
		expect(failed).toMatchObject({ loading: false, error: "401 unauthorized", updated: null });
	});

	it("USD 之外的余额单位保留两位小数并标注 remaining", () => {
		expect(subscriptionBalance({ label: "额度", used: 2, limit: 10, unit: "CNY" }, (v) => String(v))).toEqual({
			label: "额度",
			remaining: "8.00 CNY remaining",
		});
		expect(subscriptionBalance({ label: "额度", used: 2, limit: 10, unit: "次可用" }, (v) => String(v))).toEqual({
			label: "额度",
			remaining: "10 次可用",
		});
	});
});

describe("quotaUrgency", () => {
	const windowWith = (percent: number | null) => ({ id: String(percent), label: "窗口", remaining_percent: percent, resets_at: null });

	it("只有真正用完的窗口才是红点", () => {
		expect(quotaUrgency([windowWith(0)])).toBe("critical");
		// 0.4% 这类浮点余量展示取整后也是 0%，与进度条的耗尽判定一致。
		expect(quotaUrgency([windowWith(0.4)])).toBe("critical");
		expect(quotaUrgency([windowWith(100), windowWith(0)])).toBe("critical");
	});

	it("低但没用完的窗口只到黄点，比如 18% 与 14%", () => {
		expect(quotaUrgency([windowWith(18), windowWith(14)])).toBe("warning");
		expect(quotaUrgency([windowWith(12)])).toBe("warning");
	});

	it("没有用完的窗口但有窗口不高于 33% 是黄点", () => {
		expect(quotaUrgency([windowWith(100), windowWith(33)])).toBe("warning");
		expect(quotaUrgency([windowWith(30)])).toBe("warning");
		expect(quotaUrgency([windowWith(20)])).toBe("warning");
	});

	it("全部高于 33% 才是绿点，无法判断时不画点", () => {
		expect(quotaUrgency([windowWith(34), windowWith(100)])).toBe("healthy");
		expect(quotaUrgency([])).toBeNull();
		expect(quotaUrgency([windowWith(null)])).toBeNull();
	});

	it("最低窗口百分比忽略未知值", () => {
		expect(lowestRemainingPercent([windowWith(80), windowWith(null), windowWith(42)])).toBe(42);
		expect(lowestRemainingPercent([])).toBeNull();
	});
});

describe("groupQuotaAccountRows", () => {
	it("同一 provider 的不同拼写并入一组，组按品牌名排序、组内按账号名排序", () => {
		const providers: BuiltInQuotaAccount[] = [
			{
				id: "grok-1",
				provider: "grok",
				label: "xAI 按量 Key",
				models: ["grok-4"],
				account_kind: "unknown",
				plan: null,
				subscription_expires_at: null,
				windows: [],
				balances: [],
				fetched_at: "2026-11-19T02:46:37Z",
			},
		];
		const accounts: UpstreamAccount[] = [
			{ auth_index: "z", filename: "z.json", provider: "claude", email: "zed@example.com" },
			{ auth_index: "m", filename: "m.json", provider: "anthropic", email: "mary@example.com" },
			{ auth_index: "x", filename: "x.json", provider: "xai", email: "xavier@example.com" },
		];
		const rows = quotaAccountRows({ providers, accounts, quotas: {}, formatUsd: (v) => String(v) });
		const groups = groupQuotaAccountRows(rows);
		expect(groups.map((group) => [group.label, group.rows.map((row) => row.name)])).toEqual([
			["Claude", ["mary@example.com", "zed@example.com"]],
			["xAI", ["xAI 按量 Key", "xavier@example.com"]],
		]);
		expect(groups[1].rows.map((row) => row.provider)).toEqual(["xai", "xai"]);
	});
});
