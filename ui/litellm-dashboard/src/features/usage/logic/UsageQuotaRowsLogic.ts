import { accountIdentity } from "../../cliproxy/logic/AccountIdentityLogic";
import { isRemainingExhausted } from "../../platform/logic/QuotaDisplayLogic";
import { getProviderBrand } from "../../providers/logic/ProviderBrands";
import type { AccountQuota, BuiltInQuotaAccount, QuotaWindow, UpstreamAccount } from "../api/UpstreamQuotaApi";

/** 表格里的余额已经格式化：单位、remaining 后缀和金额精度都在这里定，模板只负责摆放。 */
export interface QuotaBalanceRow {
	label: string;
	remaining: string;
	details?: readonly string[];
}

/** 账号紧急程度：红点只在某个窗口真正用完时出现，黄点表示有窗口不高于 33%，绿点表示全部高于 33%。 */
export type QuotaUrgency = "critical" | "warning" | "healthy";
/** 账号行概览的阈值；与单条进度条的档位分开：红点只看“是否真的用完”，低但未用完算黄。 */
export const QUOTA_URGENCY_THRESHOLD_PERCENT = 33;
/** 一行一个账号：内置 provider key 与订阅账号共用一个形状，才能按 provider 合并分组。 */
export interface QuotaAccountRow {
	key: string;
	/** 只在内置 provider key 上设置，保留原有卡片时代的定位锚点。 */
	testid?: string;
	/** 规范化后的 provider key，用于分组与取品牌样式。 */
	provider: string;
	/** provider 展示名，用于分组排序。 */
	label: string;
	name: string;
	models: readonly string[];
	kind: string;
	plan: string | null;
	expires: string | null;
	windows: QuotaWindow[];
	/** 没有可比较的窗口时为空，表示不给判断，页面上不画点。 */
	urgency: QuotaUrgency | null;
	/** 最低的窗口剩余百分比，用于悬停说明。 */
	lowestPercent: number | null;
	balances: QuotaBalanceRow[];
	error: string | null;
	warning: string | null;
	loading: boolean;
	updated: string | null;
}

export interface QuotaAccountGroup {
	provider: string;
	label: string;
	rows: QuotaAccountRow[];
}

/** 订阅账号额度是逐个查询的，加载中与失败都要能在行上表达。 */
export interface QuotaQueryState {
	status: "loading" | "success" | "error";
	data?: AccountQuota;
	error?: string;
}

/** 取所有窗口里已知的剩余百分比；null 与 NaN 不参与比较。 */
function knownPercents(windows: readonly QuotaWindow[]): number[] {
	return windows.map((window) => window.remaining_percent).filter((value): value is number => value !== null && Number.isFinite(value));
}

export function lowestRemainingPercent(windows: readonly QuotaWindow[]): number | null {
	const known = knownPercents(windows);
	return known.length ? Math.min(...known) : null;
}

/**
 * 账号行的紧急程度。
 *
 * 红色只留给真正用完的窗口（剩余取整为 0%，含 0.4% 这类浮点余量）；没耗尽但还有窗口不高于 33%
 * 算黄；全部高于 33% 才是绿。三个判断都只看已有数值，无法判断时返回 null，页面上不画点。
 */
export function quotaUrgency(windows: readonly QuotaWindow[]): QuotaUrgency | null {
	const known = knownPercents(windows);
	if (!known.length) return null;
	if (windows.some((window) => isRemainingExhausted(window.remaining_percent))) return "critical";
	return known.some((percent) => percent <= QUOTA_URGENCY_THRESHOLD_PERCENT) ? "warning" : "healthy";
}

export function builtInAccountKind(kind: string): string {
	return kind === "subscription" ? "Subscription key" : kind === "pay_as_you_go" ? "Pay-as-you-go key" : "Unrecognized key";
}

/** 订阅账号余额按“剩余 = 上限 - 已用”折算；“次可用”这类单位本身就是剩余次数，不再相减。 */
export function subscriptionBalance(
	balance: { label: string; used: number; limit: number; unit: string },
	formatUsd: (value: number) => string,
): QuotaBalanceRow {
	if (balance.unit === "次可用") return { label: balance.label, remaining: balance.limit.toFixed(0) + " " + balance.unit };
	const remaining = Math.max(0, balance.limit - balance.used);
	return {
		label: balance.label,
		remaining: balance.unit === "USD" ? formatUsd(remaining) + " remaining" : remaining.toFixed(2) + " " + balance.unit + " remaining",
	};
}

/**
 * 内置 provider key 与订阅账号都摊平成账号行，交给同一个表格渲染。
 * 订阅账号的额度可能还没回来（loading）或失败（error），这两种状态只写在自己的行上，不影响其他行。
 */
export function quotaAccountRows(input: {
	providers: readonly BuiltInQuotaAccount[];
	accounts: readonly UpstreamAccount[];
	quotas: Readonly<Record<string, QuotaQueryState>>;
	formatUsd: (value: number) => string;
}): QuotaAccountRow[] {
	const builtIn = input.providers.map((account) => {
		const brand = getProviderBrand(account.provider);
		return {
			key: "builtin-" + account.id,
			testid: "builtin-provider-quota-" + account.provider,
			provider: brand.key,
			label: brand.label,
			name: account.label,
			models: account.models,
			kind: builtInAccountKind(account.account_kind),
			plan: account.plan,
			expires: account.subscription_expires_at,
			windows: account.windows,
			urgency: quotaUrgency(account.windows),
			lowestPercent: lowestRemainingPercent(account.windows),
			balances: account.balances.map((balance) => ({
				label: balance.label,
				remaining:
					balance.remaining.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + balance.unit,
				details: balance.details,
			})),
			error: account.error ?? null,
			warning: account.warning ?? null,
			loading: false,
			updated: account.fetched_at,
		};
	});
	const subscriptions = input.accounts.map((account) => {
		const brand = getProviderBrand(account.provider),
			quota = input.quotas[account.auth_index];
		return {
			key: "account-" + account.auth_index,
			provider: brand.key,
			label: brand.label,
			// 认证文件只有 slug 时退回账号键，至少能让人对上账号。
			name: accountIdentity(account, quota?.data?.email) ?? account.key,
			models: [],
			kind: "Subscription account",
			plan: quota?.data?.plan ?? null,
			expires: quota?.data?.subscription_expires_at ?? null,
			windows: quota?.data?.windows ?? [],
			urgency: quotaUrgency(quota?.data?.windows ?? []),
			lowestPercent: lowestRemainingPercent(quota?.data?.windows ?? []),
			balances: (quota?.data?.balances ?? []).map((balance) => subscriptionBalance(balance, input.formatUsd)),
			error: quota?.status === "error" ? (quota.error ?? "Quota unavailable") : null,
			warning: null,
			loading: quota?.status === "loading",
			updated: quota?.data?.fetched_at ?? null,
		};
	});
	return [...builtIn, ...subscriptions];
}

/**
 * 按 provider 分组，组内按账号名排序；组顺序跟 provider 展示名走。
 * 同一个 provider 的内置 key 与订阅账号因此落在同一条分组带下，便于一起看额度。
 */
export function groupQuotaAccountRows(rows: readonly QuotaAccountRow[]): QuotaAccountGroup[] {
	const byProvider = new Map<string, QuotaAccountGroup>();
	for (const row of rows) {
		const group = byProvider.get(row.provider);
		if (group) group.rows.push(row);
		else byProvider.set(row.provider, { provider: row.provider, label: row.label, rows: [row] });
	}
	for (const group of byProvider.values()) group.rows.sort((left, right) => left.name.localeCompare(right.name));
	return [...byProvider.values()].sort((left, right) => left.label.localeCompare(right.label));
}
