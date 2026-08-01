"use client";

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
	};
	return colors[provider.toLowerCase()] ?? "default";
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
	return `${remaining.toFixed(2)} ${balance.unit} remaining`;
}

const CliProxySubscriptionQuota: React.FC<CliProxySubscriptionQuotaProps> = ({ enabled }) => {
	const [accounts, setAccounts] = useState<CliProxyAccount[] | null>(null);
	const [quotaStates, setQuotaStates] = useState<Record<string, QuotaState>>({});
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
		setRefreshing(false);
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
			void loadAccountsAndQuotas(controller.signal);
		}, 0);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [enabled, loadAccountsAndQuotas]);

	if (!enabled || accounts === null || accounts.length === 0) {
		return null;
	}

	return (
		<section className="mt-8 border-t border-slate-200 pt-6" data-testid="cliproxy-subscription-quota">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<Typography.Title level={4} className="!mb-1">
						CLIProxy API subscription quota
					</Typography.Title>
					<Typography.Text type="secondary">
						Remaining quota across the current CLI subscription accounts.
					</Typography.Text>
				</div>
				<Button
					icon={<ReloadOutlined />}
					loading={refreshing}
					onClick={() => void loadQuotas(accounts)}
					data-testid="cliproxy-quota-refresh"
				>
					Refresh
				</Button>
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
				{accounts.map((account) => {
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
