"use client";
import { formatMoney, usePriceDisplay } from "@/contexts/PriceDisplay";

import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Progress, Skeleton, Tag, Typography } from "antd";
import React, { useCallback, useEffect, useState } from "react";

import { dashboardFetch } from "../../networking";

interface CliProxyAccount {
	auth_index: string;
	filename: string;
	provider: string;
	email: string | null;
}

interface QuotaWindow {
	id: string;
	label: string;
	remaining_percent: number | null;
	resets_at: string | null;
}

interface QuotaBalance {
	label: string;
	used: number;
	limit: number;
	unit: string;
}

interface AccountQuota {
	provider: string;
	plan: string | null;
	subscription_expires_at: string | null;
	windows: QuotaWindow[];
	balances: QuotaBalance[];
	fetched_at: string;
}

/** A quota window returned for a built-in provider account. */
interface BuiltInQuotaWindow {
	id: string;
	label: string;
	remaining_percent: number | null;
	resets_at: string | null;
}

/** A balance row returned for a built-in provider account. */
interface BuiltInQuotaBalance {
	label: string;
	remaining: number;
	unit: string;
	details?: string[];
}

/** Account kind detected from the configured key. */
type BuiltInAccountKind = "subscription" | "pay_as_you_go" | "unknown";

/** One built-in provider account. */
interface BuiltInQuotaAccount {
	id: string;
	provider: string;
	label: string;
	models: string[];
	account_kind: BuiltInAccountKind;
	plan: string | null;
	subscription_expires_at: string | null;
	windows: BuiltInQuotaWindow[];
	balances: BuiltInQuotaBalance[];
	warning?: string;
	fetched_at: string;
	error?: string;
}

interface QuotaState {
	status: "loading" | "success" | "error";
	data?: AccountQuota;
	error?: string;
}

interface CliProxySubscriptionQuotaProps {
	enabled: boolean;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
	const response = await dashboardFetch(path, { signal });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = body?.error?.message ?? body?.message ?? `HTTP ${response.status}`;
		throw new Error(String(message));
	}
	return body as T;
}

function providerColor(provider: string): string {
	const colors: Record<string, string> = {
		codex: "blue",
		claude: "orange",
		anthropic: "orange",
		kimi: "purple",
		antigravity: "cyan",
		xai: "default",
		deepseek: "cyan",
		minimax: "geekblue",
	};
	return colors[provider.toLowerCase()] ?? "default";
}

function accountKindLabel(kind: BuiltInAccountKind): string {
	if (kind === "subscription") return "Subscription key";
	if (kind === "pay_as_you_go") return "Pay-as-you-go key";
	return "Unrecognized key";
}

function quotaColor(remainingPercent: number | null): string {
	if (remainingPercent !== null && remainingPercent < 20) return "#ff4d4f";
	if (remainingPercent !== null && remainingPercent < 50) return "#faad14";
	return "#52c41a";
}

function formatBalance(balance: QuotaBalance): string {
	if (balance.unit === "次可用") {
		return `${balance.limit.toFixed(0)} ${balance.unit}`;
	}
	const remaining = Math.max(0, balance.limit - balance.used);
	if (balance.unit === "USD") return formatMoney(remaining, 2) + " remaining";
	return `${remaining.toFixed(2)} ${balance.unit} remaining`;
}

/** Format a provider balance in its own currency; provider balances are not USD. */
function formatProviderBalance(balance: BuiltInQuotaBalance): string {
	const amount = balance.remaining.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	return `${balance.unit} ${amount} remaining`;
}

/**
 * Upstream account quota cards: CLIProxy subscription accounts plus built-in
 * DeepSeek and MiniMax keys, rendered as one list so the usage page has a single
 * place for "what is left upstream".
 * @param root0 - component props
 * @param root0.enabled - whether the current user may read quota data
 */
const CliProxySubscriptionQuota: React.FC<CliProxySubscriptionQuotaProps> = ({ enabled }) => {
	usePriceDisplay();
	const [accounts, setAccounts] = useState<CliProxyAccount[] | null>(null);
	const [quotaStates, setQuotaStates] = useState<Record<string, QuotaState>>({});
	const [builtInAccounts, setBuiltInAccounts] = useState<BuiltInQuotaAccount[] | null>(null);
	const [builtInError, setBuiltInError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);

	const loadQuotas = useCallback(async (nextAccounts: CliProxyAccount[], signal?: AbortSignal) => {
		setRefreshing(true);
		setQuotaStates((current) =>
			Object.fromEntries(
				nextAccounts.map((account) => [
					account.auth_index,
					{ status: "loading", data: current[account.auth_index]?.data } satisfies QuotaState,
				]),
			),
		);

		const results = await Promise.all(
			nextAccounts.map(async (account) => {
				try {
					const data = await getJson<AccountQuota>(
						`/cliproxy/accounts/${encodeURIComponent(account.auth_index)}/quota`,
						signal,
					);
					return [account.auth_index, { status: "success", data } satisfies QuotaState] as const;
				} catch (error) {
					if (signal?.aborted) return null;
					return [
						account.auth_index,
						{
							status: "error",
							error: error instanceof Error ? error.message : String(error),
						} satisfies QuotaState,
					] as const;
				}
			}),
		);

		if (signal?.aborted) return;
		setQuotaStates(Object.fromEntries(results.filter((result) => result !== null)));
	}, []);

	const loadBuiltInQuotas = useCallback(async (signal?: AbortSignal, force = false) => {
		setRefreshing(true);
		try {
			const data = await getJson<{ data: BuiltInQuotaAccount[] }>(
				`/provider/quota${force ? "?refresh=true" : ""}`,
				signal,
			);
			if (signal?.aborted) return;
			setBuiltInAccounts(data.data);
			setBuiltInError(null);
		} catch (error) {
			if (signal?.aborted) return;
			// The built-in section is optional: an unreachable endpoint must not
			// break the rest of the usage page.
			setBuiltInAccounts([]);
			setBuiltInError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const loadAccountsAndQuotas = useCallback(
		async (signal?: AbortSignal) => {
			try {
				const response = await getJson<{ data: CliProxyAccount[] }>("/cliproxy/accounts", signal);
				if (signal?.aborted) return;
				setAccounts(response.data);
				if (response.data.length > 0) {
					await loadQuotas(response.data, signal);
				}
			} catch {
				if (!signal?.aborted) {
					// Usage is also available to non-admin users. If CLIProxy
					// management is inaccessible, keep this optional section hidden.
					setAccounts([]);
				}
			}
		},
		[loadQuotas],
	);

	useEffect(() => {
		if (!enabled) return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			void Promise.all([loadAccountsAndQuotas(controller.signal), loadBuiltInQuotas(controller.signal)]).finally(() => {
				if (!controller.signal.aborted) {
					setRefreshing(false);
				}
			});
		}, 0);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [enabled, loadAccountsAndQuotas, loadBuiltInQuotas]);

	const refresh = useCallback(async () => {
		setRefreshing(true);
		try {
			// Refresh quota only: the account list did not change, and re-reading it
			// would make the refresh look like a navigation.
			const cliProxyRefresh = accounts && accounts.length > 0 ? loadQuotas(accounts) : Promise.resolve();
			await Promise.all([cliProxyRefresh, loadBuiltInQuotas(undefined, true)]);
		} finally {
			setRefreshing(false);
		}
	}, [accounts, loadQuotas, loadBuiltInQuotas]);

	if (!enabled) {
		return null;
	}

	const cliProxyAccounts = accounts ?? [];
	const providers = builtInAccounts ?? [];
	if (cliProxyAccounts.length === 0 && providers.length === 0 && builtInError === null) {
		return null;
	}

	return (
		<section className="mt-8 border-t border-slate-200 pt-6" data-testid="upstream-account-quota">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<Typography.Title level={4} className="!mb-1">
						Upstream account quota
					</Typography.Title>
					<Typography.Text type="secondary">
						Remaining quota and balance for CLIProxy accounts and built-in provider keys.
					</Typography.Text>
				</div>
				<Button
					icon={<ReloadOutlined />}
					loading={refreshing}
					onClick={() => void refresh()}
					data-testid="upstream-quota-refresh"
				>
					Refresh
				</Button>
			</div>

			{builtInError && (
				<Alert className="mb-4" type="warning" showIcon message="Built-in provider quota unavailable" description={builtInError} />
			)}

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
				{providers.map((account) => (
					<Card
						key={account.id}
						className="h-full"
						data-testid={`builtin-provider-quota-${account.provider}`}
						title={
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<Tag color={providerColor(account.provider)} className="!mr-0">
										{account.provider}
									</Tag>
									<Typography.Text strong ellipsis={{ tooltip: account.label }}>
										{account.label}
									</Typography.Text>
								</div>
								{account.models.length > 0 && (
									<Typography.Text
										type="secondary"
										className="!text-xs"
										ellipsis={{ tooltip: account.models.join(", ") }}
									>
										{account.models.join(", ")}
									</Typography.Text>
								)}
							</div>
						}
						extra={
							<div className="flex flex-col items-end gap-1">
								<Tag className="!mr-0">{accountKindLabel(account.account_kind)}</Tag>
								{account.plan ? <Tag color="blue">{account.plan}</Tag> : null}
							</div>
						}
					>
						{account.error && (
							<Alert className="mb-3" type="warning" showIcon message="Quota query failed" description={account.error} />
						)}

						{account.warning && <Alert className="mb-3" type="info" showIcon message={account.warning} />}

						{account.windows.length > 0 && (
							<div className="space-y-4">
								{account.windows.map((window) => {
									const remaining = window.remaining_percent === null ? null : Math.round(window.remaining_percent);
									return (
										<div key={window.id}>
											<div className="mb-1 flex items-center justify-between gap-4">
												<Typography.Text strong>{window.label}</Typography.Text>
												<Typography.Text>{remaining === null ? "—" : `${remaining}% remaining`}</Typography.Text>
											</div>
											<Progress
												percent={remaining ?? 0}
												showInfo={false}
												strokeColor={quotaColor(window.remaining_percent)}
											/>
											{window.resets_at && (
												<Typography.Text type="secondary" className="!text-xs">
													Resets {new Date(window.resets_at).toLocaleString()}
												</Typography.Text>
											)}
										</div>
									);
								})}
							</div>
						)}

						{account.balances.length > 0 && (
							<div className="space-y-2">
								{account.balances.map((balance) => (
									<div
										key={`${balance.label}-${balance.unit}`}
										className="rounded-lg border border-slate-200 px-3 py-2"
									>
										<div className="flex items-center justify-between gap-3">
											<Typography.Text strong>{balance.label}</Typography.Text>
											<Typography.Text>{formatProviderBalance(balance)}</Typography.Text>
										</div>
										{balance.details && balance.details.length > 0 && (
											<Typography.Text type="secondary" className="!text-xs">
												{balance.details.join(" · ")}
											</Typography.Text>
										)}
									</div>
								))}
							</div>
						)}

						{!account.error && account.windows.length === 0 && account.balances.length === 0 && !account.warning && (
							<Alert type="info" showIcon message="This account returned no quota details." />
						)}

						<Typography.Text type="secondary" className="mt-3 block !text-xs">
							Updated {new Date(account.fetched_at).toLocaleString()}
						</Typography.Text>
					</Card>
				))}

				{cliProxyAccounts.map((account) => {
					const quotaState = quotaStates[account.auth_index] ?? { status: "loading" };
					const quota = quotaState.data;
					return (
						<Card
							key={account.auth_index}
							className="h-full"
							title={
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<Tag color={providerColor(account.provider)} className="!mr-0">
											{account.provider}
										</Tag>
										<Typography.Text strong ellipsis={{ tooltip: account.email ?? account.filename }}>
											{account.email ?? account.filename}
										</Typography.Text>
									</div>
								</div>
							}
							extra={quota?.plan ? <Tag color="blue">{quota.plan}</Tag> : null}
						>
							{quotaState.status === "loading" && !quota && <Skeleton active paragraph={{ rows: 3 }} />}

							{quotaState.status === "error" && !quota && (
								<Alert type="warning" showIcon message="Quota unavailable" description={quotaState.error} />
							)}

							{quota && (
								<div className="space-y-4">
									{quota.subscription_expires_at && (
										<Typography.Text type="secondary" className="block !text-xs">
											Subscription expires {new Date(quota.subscription_expires_at).toLocaleString()}
										</Typography.Text>
									)}

									{quota.windows.map((window) => {
										const remaining = window.remaining_percent === null ? null : Math.round(window.remaining_percent);
										return (
											<div key={window.id}>
												<div className="mb-1 flex items-center justify-between gap-4">
													<Typography.Text strong>{window.label}</Typography.Text>
													<Typography.Text>{remaining === null ? "—" : `${remaining}% remaining`}</Typography.Text>
												</div>
												<Progress
													percent={remaining ?? 0}
													showInfo={false}
													strokeColor={quotaColor(window.remaining_percent)}
												/>
												{window.resets_at && (
													<Typography.Text type="secondary" className="!text-xs">
														Resets {new Date(window.resets_at).toLocaleString()}
													</Typography.Text>
												)}
											</div>
										);
									})}

									{quota.balances.map((balance) => (
										<div
											key={`${balance.label}-${balance.unit}`}
											className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2"
										>
											<Typography.Text strong>{balance.label}</Typography.Text>
											<Typography.Text>{formatBalance(balance)}</Typography.Text>
										</div>
									))}

									{quota.windows.length === 0 && quota.balances.length === 0 && (
										<Alert type="info" showIcon message="This provider returned no remaining quota details." />
									)}

									<Typography.Text type="secondary" className="block !text-xs">
										Updated {new Date(quota.fetched_at).toLocaleString()}
									</Typography.Text>
								</div>
							)}
						</Card>
					);
				})}
			</div>
		</section>
	);
};

export default CliProxySubscriptionQuota;
