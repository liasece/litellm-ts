"use client";

import { CloudDownloadOutlined, ReloadOutlined, RollbackOutlined } from "@ant-design/icons";
import CliProxyConfigEditor from "@/components/cliproxy/CliProxyConfigEditor";
import CliProxyLogViewer, { type CliProxyLogEntry } from "@/components/cliproxy/CliProxyLogViewer";
import CliProxyReleaseHistory, { type CliProxyReleaseInfo } from "@/components/cliproxy/CliProxyReleaseHistory";
import { dashboardFetch } from "@/components/networking";
import NotificationsManager from "@/components/molecules/notifications_manager";
import {
	Alert,
	Button,
	Card,
	Col,
	Input,
	InputNumber,
	Modal,
	Popconfirm,
	Progress,
	Row,
	Select,
	Space,
	Spin,
	Switch,
	Table,
	Tabs,
	Tag,
	Typography,
} from "antd";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface RuntimeStatus {
	available: boolean;
	enabled: boolean;
	state: string;
	version: string | null;
	installed_versions: string[];
	pid: number | null;
	started_at: string | null;
	uptime_seconds: number | null;
	restart_count: number;
	last_exit_code: number | null;
	last_error: string | null;
	config_hash: string | null;
	health: string;
	operation: string | null;
}

interface Account {
	auth_index: string;
	filename: string;
	provider: string;
	email: string | null;
	disabled: boolean;
	weight: number | null;
	modified_at: string;
}

interface QuotaWindow {
	id: string;
	label: string;
	used_percent: number | null;
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

interface AccountQuotaState {
	status: "idle" | "loading" | "success" | "error";
	data?: AccountQuota;
	error?: string;
}

interface OAuthSession {
	id: string;
	provider: string;
	state: string;
	started_at: string;
	finished_at: string | null;
	exit_code: number | null;
	output: string[];
}

interface UpdateInfo {
	current: string | null;
	latest: string;
	update_available: boolean;
	releases: CliProxyReleaseInfo[];
}

interface ConfigResponse {
	settings: { enabled: boolean; config_yaml: string };
	user_config: Record<string, unknown>;
	status: RuntimeStatus;
}

const ADVANCED_MANAGEMENT_RESOURCES = [
	{ value: "/debug", label: "Debug mode" },
	{ value: "/request-log", label: "Request logging" },
	{ value: "/request-retry", label: "Request retry" },
	{ value: "/max-retry-interval", label: "Maximum retry interval" },
	{ value: "/force-model-prefix", label: "Force model prefix" },
	{ value: "/ws-auth", label: "WebSocket authentication" },
	{ value: "/routing/strategy", label: "Routing strategy" },
	{ value: "/usage-statistics-enabled", label: "Usage statistics" },
	{ value: "/api-key-usage", label: "API key usage" },
	{ value: "/usage-queue", label: "Usage queue" },
	{ value: "/request-error-logs", label: "Request error logs" },
	{ value: "/logs", label: "CLIProxy file logs" },
	{ value: "/plugins", label: "Installed plugins" },
	{ value: "/plugin-store", label: "Plugin store" },
	{ value: "/openai-compatibility", label: "OpenAI compatibility providers" },
	{ value: "/oauth-excluded-models", label: "OAuth excluded models" },
	{ value: "/oauth-model-alias", label: "OAuth model aliases" },
] as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await dashboardFetch(path, {
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message = body?.error?.message ?? body?.message ?? `HTTP ${response.status}`;
		throw new Error(String(message));
	}
	return body as T;
}

async function advancedManagementApi(resource: string, method: string, requestBody: string): Promise<unknown> {
	const normalized = resource.startsWith("/") ? resource : `/${resource}`;
	const hasBody = ["POST", "PUT", "PATCH"].includes(method);
	let body: string | undefined;
	if (hasBody && requestBody.trim().length > 0) {
		body = JSON.stringify(JSON.parse(requestBody) as unknown);
	}
	const response = await dashboardFetch(`/cliproxy/management${normalized}`, {
		method,
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body,
	});
	const text = await response.text();
	let value: unknown = text;
	try {
		value = text.length > 0 ? (JSON.parse(text) as unknown) : null;
	} catch {
		// Keep text responses and download metadata readable in the console.
	}
	if (!response.ok) {
		const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
		const nested =
			typeof record.error === "object" && record.error !== null ? (record.error as Record<string, unknown>) : {};
		throw new Error(String(nested.message ?? record.message ?? text ?? `HTTP ${response.status}`));
	}
	return value;
}

function stateColor(state: string): string {
	if (state === "running") return "green";
	if (state === "starting" || state === "updating") return "blue";
	if (state === "stopped") return "default";
	return "red";
}

function quotaColor(remainingPercent: number | null): string {
	if (remainingPercent !== null && remainingPercent < 20) return "#ff4d4f";
	if (remainingPercent !== null && remainingPercent < 50) return "#faad14";
	return "#52c41a";
}

function providerColor(provider: string): string {
	const colors: Record<string, string> = {
		codex: "blue",
		claude: "orange",
		kimi: "purple",
		antigravity: "cyan",
		xai: "default",
	};
	return colors[provider.toLowerCase()] ?? "default";
}

const SubscriptionQuotaCard: React.FC<{
	account: Account;
	quotaState: AccountQuotaState;
	onRefresh: () => void;
}> = ({ account, quotaState, onRefresh }) => {
	const quota = quotaState.data;
	const loadingWithoutData = quotaState.status === "loading" && !quota;

	return (
		<Card
			size="small"
			data-cliproxy-quota-card="true"
			data-provider={account.provider}
			className="h-full overflow-hidden"
			title={
				<div className="min-w-0 py-1">
					<div className="mb-1 flex items-center gap-2">
						<Tag color={providerColor(account.provider)} className="!mr-0">
							{account.provider}
						</Tag>
						<Typography.Text strong ellipsis={{ tooltip: account.email ?? account.filename }}>
							{account.email ?? account.filename}
						</Typography.Text>
					</div>
					<Typography.Text type="secondary" className="block !max-w-[280px] !text-xs" ellipsis>
						{account.filename}
					</Typography.Text>
				</div>
			}
			extra={
				<Button size="small" loading={quotaState.status === "loading"} onClick={onRefresh}>
					Refresh
				</Button>
			}
		>
			{loadingWithoutData && (
				<div className="flex h-56 items-center justify-center">
					<Spin />
				</div>
			)}

			{quotaState.status === "idle" && (
				<div className="flex h-56 flex-col items-center justify-center gap-3 text-center">
					<Typography.Text type="secondary">Quota has not been queried yet.</Typography.Text>
					<Button onClick={onRefresh}>Load subscription quota</Button>
				</div>
			)}

			{quotaState.status === "error" && !quota && (
				<Alert
					type="error"
					showIcon
					message="Quota query failed"
					description={quotaState.error}
					action={
						<Button size="small" danger onClick={onRefresh}>
							Retry
						</Button>
					}
				/>
			)}

			{quota && (
				<Space direction="vertical" size="middle" className="w-full">
					<div className="rounded-lg bg-slate-50 px-3 py-2">
						<div className="flex items-center justify-between gap-3">
							<Typography.Text type="secondary">Subscription plan</Typography.Text>
							<Typography.Text strong>{quota.plan ?? "—"}</Typography.Text>
						</div>
						{quota.subscription_expires_at && (
							<div className="mt-1 flex items-center justify-between gap-3">
								<Typography.Text type="secondary">Expires</Typography.Text>
								<Typography.Text>{new Date(quota.subscription_expires_at).toLocaleString()}</Typography.Text>
							</div>
						)}
					</div>

					{quota.windows.map((window) => {
						const remaining = window.remaining_percent === null ? 0 : Math.round(window.remaining_percent);
						return (
							<div key={window.id}>
								<div className="mb-1 flex items-center justify-between gap-4">
									<Typography.Text strong>{window.label}</Typography.Text>
									<Typography.Text>
										{window.remaining_percent === null ? "—" : `${remaining}% remaining`}
									</Typography.Text>
								</div>
								<Progress
									percent={remaining}
									showInfo={false}
									status="normal"
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
							<Typography.Text>
								{balance.unit === "次可用"
									? `${balance.limit.toFixed(0)} ${balance.unit}`
									: `${balance.used.toFixed(2)} / ${balance.limit.toFixed(2)} ${balance.unit}`}
							</Typography.Text>
						</div>
					))}

					{quota.windows.length === 0 && quota.balances.length === 0 && (
						<Alert type="info" showIcon message="This provider returned no quota windows or balances." />
					)}

					{quotaState.status === "error" && (
						<Alert
							type="warning"
							showIcon
							message="Refresh failed; showing the previous result."
							description={quotaState.error}
						/>
					)}

					<Typography.Text type="secondary" className="!text-xs">
						Updated {new Date(quota.fetched_at).toLocaleString()}
					</Typography.Text>
				</Space>
			)}
		</Card>
	);
};

const CliProxyManagement: React.FC = () => {
	const [status, setStatus] = useState<RuntimeStatus | null>(null);
	const [configYaml, setConfigYaml] = useState("");
	const [rawConfigDraft, setRawConfigDraft] = useState("");
	const [rawConfigOpen, setRawConfigOpen] = useState(false);
	const [userConfig, setUserConfig] = useState<Record<string, unknown>>({});
	const [enabled, setEnabled] = useState(true);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [logs, setLogs] = useState<CliProxyLogEntry[]>([]);
	const [logCursor, setLogCursor] = useState(0);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState("overview");
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [rollbackVersion, setRollbackVersion] = useState<string | null>(null);
	const [oauthSession, setOAuthSession] = useState<OAuthSession | null>(null);
	const [oauthInput, setOAuthInput] = useState("");
	const [quotaStates, setQuotaStates] = useState<Record<string, AccountQuotaState>>({});
	const [managementResource, setManagementResource] = useState("/debug");
	const [managementMethod, setManagementMethod] = useState("GET");
	const [managementBody, setManagementBody] = useState("{}");
	const [managementResult, setManagementResult] = useState<unknown>(null);
	const quotaLoadedOnce = useRef(false);

	const refreshStatus = useCallback(async () => {
		const value = await api<RuntimeStatus>("/cliproxy/status");
		setStatus(value);
	}, []);

	const refreshAccounts = useCallback(async () => {
		const value = await api<{ data: Account[] }>("/cliproxy/accounts");
		setAccounts(value.data);
	}, []);

	const logsFetchInFlight = useRef<number | null>(null);

	const refreshLogs = useCallback(async () => {
		// in-flight 守卫：请求耗时超过轮询间隔时跳过本轮，避免同一 cursor 并发拉取导致重复条目。
		// 若请求悬挂超过 10s（后端无响应），视为陈旧，允许下一轮重新发起，避免日志面板永久停更。
		if (logsFetchInFlight.current !== null && Date.now() - logsFetchInFlight.current < 10_000) {
			return;
		}
		logsFetchInFlight.current = Date.now();
		try {
			const value = await api<{ entries: CliProxyLogEntry[]; cursor: number }>(`/cliproxy/logs?after=${logCursor}`);
			setLogCursor(value.cursor);
			if (value.entries.length > 0) {
				setLogs((current) => [...current, ...value.entries].slice(-2_000));
			}
		} finally {
			logsFetchInFlight.current = null;
		}
	}, [logCursor]);

	const reloadLogs = useCallback(async () => {
		setBusy("logs refresh");
		try {
			const value = await api<{ entries: CliProxyLogEntry[]; cursor: number }>("/cliproxy/logs");
			setLogs(value.entries);
			setLogCursor(value.cursor);
		} catch (error) {
			NotificationsManager.fromBackend(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	}, []);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [config, accountResponse, logResponse, versionInfo] = await Promise.all([
				api<ConfigResponse>("/cliproxy/config"),
				api<{ data: Account[] }>("/cliproxy/accounts"),
				api<{ entries: CliProxyLogEntry[]; cursor: number }>("/cliproxy/logs"),
				api<UpdateInfo>("/cliproxy/update/check").catch(() => null),
			]);
			setStatus(config.status);
			setEnabled(config.settings.enabled);
			setConfigYaml(config.settings.config_yaml);
			setUserConfig(config.user_config);
			setAccounts(accountResponse.data);
			setLogs(logResponse.entries);
			setLogCursor(logResponse.cursor);
			setUpdateInfo(versionInfo);
		} catch (error) {
			NotificationsManager.fromBackend(error instanceof Error ? error.message : String(error));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void load();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [load]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			void refreshStatus().catch(() => undefined);
			void refreshLogs().catch(() => undefined);
			if (oauthSession?.state === "running") {
				void api<OAuthSession>(`/cliproxy/oauth/${oauthSession.id}`)
					.then((session) => {
						setOAuthSession(session);
						if (session.state !== "running") void refreshAccounts();
					})
					.catch(() => undefined);
			}
		}, 2_000);
		return () => window.clearInterval(timer);
	}, [oauthSession?.id, oauthSession?.state, refreshAccounts, refreshLogs, refreshStatus]);

	const runOperation = async (name: string, operation: () => Promise<unknown>) => {
		setBusy(name);
		try {
			await operation();
			await refreshStatus();
			NotificationsManager.success(`CLIProxy ${name} completed`);
		} catch (error) {
			NotificationsManager.fromBackend(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};

	const saveRawConfig = () =>
		runOperation("configuration apply", async () => {
			const response = await api<ConfigResponse>("/cliproxy/config", {
				method: "PUT",
				body: JSON.stringify({ enabled, config_yaml: rawConfigDraft }),
			});
			setStatus(response.status);
			setConfigYaml(response.settings.config_yaml);
			setUserConfig(response.user_config);
			setRawConfigOpen(false);
		});

	const saveVisualConfig = async (nextEnabled: boolean, nextUserConfig: Record<string, unknown>) => {
		await runOperation("configuration apply", async () => {
			const response = await api<ConfigResponse>("/cliproxy/config", {
				method: "PUT",
				body: JSON.stringify({ enabled: nextEnabled, user_config: nextUserConfig }),
			});
			setStatus(response.status);
			setEnabled(response.settings.enabled);
			setConfigYaml(response.settings.config_yaml);
			setUserConfig(response.user_config);
		});
	};

	const checkUpdate = () =>
		runOperation("update check", async () => {
			setUpdateInfo(await api<UpdateInfo>("/cliproxy/update/check"));
		});

	const installUpdate = () =>
		runOperation("update", async () => {
			if (!updateInfo?.update_available) return;
			await api("/cliproxy/update", {
				method: "POST",
				body: JSON.stringify({ version: updateInfo.latest }),
			});
			setUpdateInfo(await api<UpdateInfo>("/cliproxy/update/check"));
		});

	const rollback = () =>
		runOperation("rollback", async () => {
			if (!rollbackVersion) return;
			await api("/cliproxy/rollback", {
				method: "POST",
				body: JSON.stringify({ version: rollbackVersion }),
			});
			setRollbackVersion(null);
			setUpdateInfo(await api<UpdateInfo>("/cliproxy/update/check"));
		});

	const startOAuth = async (provider: string) => {
		setBusy(`oauth-${provider}`);
		try {
			const session = await api<OAuthSession>("/cliproxy/oauth", {
				method: "POST",
				body: JSON.stringify({ provider }),
			});
			setOAuthSession(session);
		} catch (error) {
			NotificationsManager.fromBackend(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};

	const loadQuota = useCallback(async (account: Account) => {
		setQuotaStates((current) => ({
			...current,
			[account.auth_index]: {
				status: "loading",
				data: current[account.auth_index]?.data,
			},
		}));
		try {
			const value = await api<AccountQuota>(`/cliproxy/accounts/${encodeURIComponent(account.auth_index)}/quota`);
			setQuotaStates((current) => ({
				...current,
				[account.auth_index]: { status: "success", data: value },
			}));
		} catch (error) {
			setQuotaStates((current) => ({
				...current,
				[account.auth_index]: {
					status: "error",
					data: current[account.auth_index]?.data,
					error: error instanceof Error ? error.message : String(error),
				},
			}));
		}
	}, []);

	const refreshAllQuotas = useCallback(async () => {
		await Promise.all(accounts.map((account) => loadQuota(account)));
	}, [accounts, loadQuota]);

	const executeManagementRequest = async () => {
		setBusy("management request");
		try {
			setManagementResult(await advancedManagementApi(managementResource, managementMethod, managementBody));
			if (managementMethod !== "GET") {
				await load();
			}
			NotificationsManager.success("CLIProxy management request completed");
		} catch (error) {
			NotificationsManager.fromBackend(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(null);
		}
	};

	useEffect(() => {
		if (accounts.length === 0 || quotaLoadedOnce.current) return;
		quotaLoadedOnce.current = true;
		void refreshAllQuotas();
	}, [accounts.length, refreshAllQuotas]);

	const accountColumns = useMemo(
		() => [
			{ title: "Provider", dataIndex: "provider", key: "provider", render: (value: string) => <Tag>{value}</Tag> },
			{ title: "Account", dataIndex: "email", key: "email", render: (value: string | null) => value ?? "—" },
			{ title: "File", dataIndex: "filename", key: "filename", ellipsis: true },
			{
				title: "Enabled",
				key: "enabled",
				render: (_: unknown, account: Account) => (
					<Switch
						checked={!account.disabled}
						onChange={async (checked) => {
							await api(`/cliproxy/accounts/${encodeURIComponent(account.filename)}`, {
								method: "PATCH",
								body: JSON.stringify({ disabled: !checked }),
							});
							await refreshAccounts();
						}}
					/>
				),
			},
			{
				title: "Weight",
				key: "weight",
				render: (_: unknown, account: Account) => (
					<InputNumber
						min={1}
						max={1_000_000}
						value={account.weight ?? undefined}
						placeholder="default"
						onBlur={async (event) => {
							const raw = event.currentTarget.value;
							await api(`/cliproxy/accounts/${encodeURIComponent(account.filename)}`, {
								method: "PATCH",
								body: JSON.stringify({ weight: raw === "" ? null : Number(raw) }),
							});
							await refreshAccounts();
						}}
					/>
				),
			},
			{
				title: "Action",
				key: "action",
				render: (_: unknown, account: Account) => (
					<Popconfirm
						title="Move this account to .trash?"
						description="The token file is retained for recovery."
						onConfirm={async () => {
							await api(`/cliproxy/accounts/${encodeURIComponent(account.filename)}`, { method: "DELETE" });
							await refreshAccounts();
						}}
					>
						<Button danger size="small">
							Trash
						</Button>
					</Popconfirm>
				),
			},
		],
		[refreshAccounts],
	);

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Spin size="large" />
			</div>
		);
	}

	return (
		<div className="w-full p-4 md:p-6">
			<div className="mb-4">
				<Typography.Title level={3} className="!mb-1">
					CLIProxy API
				</Typography.Title>
				<Typography.Text type="secondary">
					Managed local runtime for Codex, Claude, Gemini and other CLI subscription credentials.
				</Typography.Text>
			</div>

			{status?.last_error && <Alert className="mb-4" type="warning" showIcon message={status.last_error} />}

			<Tabs
				activeKey={activeTab}
				onChange={setActiveTab}
				items={[
					{
						key: "overview",
						label: "Overview",
						children: (
							<Space direction="vertical" size="middle" className="w-full">
								<Card size="small">
									<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
										<div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
											<Typography.Text type="secondary" className="block !text-xs">
												State
											</Typography.Text>
											<Tag color={stateColor(status?.state ?? "unknown")} className="!mt-1 !mr-0">
												{status?.state ?? "unknown"}
											</Tag>
										</div>
										<div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
											<Typography.Text type="secondary" className="block !text-xs">
												Health
											</Typography.Text>
											<Tag color={status?.health === "healthy" ? "green" : "red"} className="!mt-1 !mr-0">
												{status?.health ?? "unknown"}
											</Tag>
										</div>
										<div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
											<Typography.Text type="secondary" className="block !text-xs">
												Version
											</Typography.Text>
											<Typography.Text strong className="block !mt-1" ellipsis>
												{status?.version ?? "Not installed"}
											</Typography.Text>
										</div>
										<div className="min-w-0 rounded-md bg-slate-50 px-3 py-2">
											<Typography.Text type="secondary" className="block !text-xs">
												Process
											</Typography.Text>
											<Typography.Text strong className="block !mt-1" ellipsis>
												{status?.pid ? `PID ${status.pid}` : "Not running"}
											</Typography.Text>
										</div>
									</div>
								</Card>
								<Card size="small" title="Runtime and updates" data-cliproxy-runtime-operations="true">
									<Row gutter={[16, 16]}>
										<Col xs={24} xl={7}>
											<div className="h-full rounded-lg border border-slate-200 p-3">
												<div className="mb-2">
													<Typography.Text strong>Service controls</Typography.Text>
													<Typography.Text type="secondary" className="mt-0.5 block !text-xs">
														Manage the private child process without stopping LiteLLM.
													</Typography.Text>
												</div>
												<Space wrap size="small">
													<Button
														size="small"
														type="primary"
														disabled={status?.state === "running" || busy !== null}
														loading={busy === "start"}
														onClick={() => runOperation("start", () => api("/cliproxy/start", { method: "POST" }))}
													>
														Start
													</Button>
													<Button
														size="small"
														disabled={status?.state !== "running" || busy !== null}
														loading={busy === "restart"}
														onClick={() => runOperation("restart", () => api("/cliproxy/restart", { method: "POST" }))}
													>
														Restart
													</Button>
													<Button
														size="small"
														danger
														disabled={status?.state === "stopped" || busy !== null}
														loading={busy === "stop"}
														onClick={() => runOperation("stop", () => api("/cliproxy/stop", { method: "POST" }))}
													>
														Stop
													</Button>
												</Space>
											</div>
										</Col>
										<Col xs={24} xl={17}>
											<div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
												<div className="mb-2 flex flex-wrap items-start justify-between gap-2">
													<div>
														<div className="flex items-center gap-2">
															<Typography.Text strong>Release channel</Typography.Text>
															{updateInfo ? (
																<Tag color={updateInfo.update_available ? "orange" : "green"}>
																	{updateInfo.update_available ? "Update available" : "Up to date"}
																</Tag>
															) : (
																<Tag>Not checked</Tag>
															)}
														</div>
														<Typography.Text type="secondary" className="!text-xs">
															Current {status?.version ?? "—"} · Latest {updateInfo?.latest ?? "—"}
														</Typography.Text>
													</div>
													<Button
														size="small"
														icon={<ReloadOutlined />}
														loading={busy === "update check"}
														disabled={busy !== null && busy !== "update check"}
														onClick={checkUpdate}
													>
														Check
													</Button>
												</div>
												<Space wrap size="small">
													<Button
														size="small"
														type="primary"
														icon={<CloudDownloadOutlined />}
														loading={busy === "update"}
														disabled={!updateInfo?.update_available || busy !== null}
														onClick={installUpdate}
													>
														{updateInfo?.update_available ? `Install ${updateInfo.latest}` : "Latest version installed"}
													</Button>
													<Select
														allowClear
														value={rollbackVersion ?? undefined}
														placeholder="Select installed version"
														size="small"
														style={{ minWidth: 180 }}
														disabled={busy !== null}
														options={(status?.installed_versions ?? [])
															.filter((version) => version !== status?.version)
															.map((version) => ({ value: version, label: version }))}
														onChange={(version) => setRollbackVersion(version ?? null)}
													/>
													<Popconfirm
														title={`Roll back to ${rollbackVersion ?? ""}?`}
														description="CLIProxy will restart after the selected version is activated."
														disabled={!rollbackVersion}
														onConfirm={rollback}
													>
														<Button
															size="small"
															icon={<RollbackOutlined />}
															disabled={!rollbackVersion || busy !== null}
															loading={busy === "rollback"}
														>
															Roll back
														</Button>
													</Popconfirm>
												</Space>
												{updateInfo && (
													<div className="mt-3">
														<CliProxyReleaseHistory
															key={updateInfo.latest}
															releases={updateInfo.releases}
															current={updateInfo.current}
															latest={updateInfo.latest}
														/>
													</div>
												)}
											</div>
										</Col>
									</Row>
									{status?.operation && (
										<Alert
											className="mt-4"
											type="info"
											showIcon
											message={`Operation in progress: ${status.operation}`}
										/>
									)}
								</Card>

								<div className="flex flex-wrap items-center justify-between gap-3 pt-1">
									<div>
										<Typography.Text strong>Subscription quota</Typography.Text>
										<Typography.Text type="secondary" className="block !text-xs">
											Current plan and remaining usage for every managed CLI subscription account.
										</Typography.Text>
									</div>
									<Button
										size="small"
										loading={accounts.some((account) => quotaStates[account.auth_index]?.status === "loading")}
										disabled={accounts.length === 0}
										onClick={() => void refreshAllQuotas()}
									>
										Refresh all
									</Button>
								</div>
								{accounts.length === 0 ? (
									<Alert
										type="info"
										showIcon
										message="No OAuth accounts"
										description="Add an account in the OAuth accounts tab before querying subscription quota."
									/>
								) : (
									<Row gutter={[12, 12]}>
										{accounts.map((account) => (
											<Col key={account.auth_index} xs={24} md={12} xl={8}>
												<SubscriptionQuotaCard
													account={account}
													quotaState={quotaStates[account.auth_index] ?? { status: "idle" }}
													onRefresh={() => void loadQuota(account)}
												/>
											</Col>
										))}
									</Row>
								)}

								<CliProxyLogViewer
									entries={logs}
									compact
									refreshing={busy === "logs refresh"}
									onRefresh={() => void reloadLogs()}
									onViewAll={() => setActiveTab("logs")}
								/>
							</Space>
						),
					},
					{
						key: "configuration",
						label: "Configuration",
						children: (
							<CliProxyConfigEditor
								key={`${enabled}-${status?.config_hash ?? "config"}`}
								enabled={enabled}
								userConfig={userConfig}
								saving={busy === "configuration apply"}
								onSave={saveVisualConfig}
								onOpenRaw={() => {
									setRawConfigDraft(configYaml);
									setRawConfigOpen(true);
								}}
							/>
						),
					},
					{
						key: "accounts",
						label: `OAuth accounts (${accounts.length})`,
						children: (
							<Space direction="vertical" size="small" className="w-full">
								<Card size="small" title="Add OAuth account">
									<Space wrap>
										<Button type="primary" onClick={() => startOAuth("codex-device")}>
											Codex device login
										</Button>
										<Button onClick={() => startOAuth("codex")}>Codex browser login</Button>
										<Button onClick={() => startOAuth("claude")}>Claude login</Button>
										<Button onClick={() => startOAuth("antigravity")}>Antigravity login</Button>
										<Button onClick={() => startOAuth("kimi")}>Kimi login</Button>
										<Button onClick={() => startOAuth("xai")}>xAI login</Button>
									</Space>
									<Typography.Paragraph type="secondary" className="!mt-3 !mb-0">
										Device login is recommended for a remote deployment. Browser callback flows may require submitting a
										value requested in the session output.
									</Typography.Paragraph>
								</Card>
								<Table
									size="small"
									rowKey="auth_index"
									dataSource={accounts}
									columns={accountColumns}
									pagination={false}
								/>
							</Space>
						),
					},
					{
						key: "logs",
						label: "Logs",
						children: (
							<CliProxyLogViewer
								entries={logs}
								refreshing={busy === "logs refresh"}
								onRefresh={() => void reloadLogs()}
								onClear={() => {
									setLogs([]);
									setLogCursor(status ? logCursor : 0);
								}}
							/>
						),
					},
					{
						key: "advanced",
						label: "Advanced",
						children: (
							<Space direction="vertical" size="small" className="w-full">
								<Alert
									type="info"
									showIcon
									message="Protected CLIProxy management console"
									description="Requests are authenticated by LiteLLM, restricted to proxy_admin, and forwarded only to an explicit allowlist. Runtime config changes are synchronized back into LiteLLM and reloaded automatically. The child process API key and raw generated config are never exposed."
								/>
								<Card size="small" title="Management request">
									<Space direction="vertical" size="middle" className="w-full">
										<Row gutter={[12, 12]}>
											<Col xs={24} md={6}>
												<Select
													className="w-full"
													value={managementMethod}
													options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({
														value,
														label: value,
													}))}
													onChange={setManagementMethod}
												/>
											</Col>
											<Col xs={24} md={18}>
												<Select
													showSearch
													className="w-full"
													value={managementResource}
													options={ADVANCED_MANAGEMENT_RESOURCES.map((item) => ({
														value: item.value,
														label: `${item.label} (${item.value})`,
													}))}
													onChange={setManagementResource}
													filterOption={(input, option) =>
														String(option?.label ?? "")
															.toLowerCase()
															.includes(input.toLowerCase())
													}
												/>
											</Col>
										</Row>
										<Input
											value={managementResource}
											onChange={(event) => setManagementResource(event.target.value)}
											placeholder="/request-error-logs/example.log"
										/>
										<Input.TextArea
											value={managementBody}
											onChange={(event) => setManagementBody(event.target.value)}
											disabled={managementMethod === "GET"}
											autoSize={{ minRows: 5, maxRows: 16 }}
											className="font-mono"
											spellCheck={false}
											placeholder='{"value": true}'
										/>
										<Button
											type="primary"
											loading={busy === "management request"}
											disabled={busy !== null && busy !== "management request"}
											onClick={() => void executeManagementRequest()}
										>
											Execute
										</Button>
									</Space>
								</Card>
								<Card size="small" title="Response">
									<pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-4 text-xs text-slate-100">
										{managementResult === null
											? "No request has been executed."
											: JSON.stringify(managementResult, null, 2)}
									</pre>
								</Card>
							</Space>
						),
					},
				]}
			/>

			<Modal
				title="Edit raw CLIProxy feature config"
				open={rawConfigOpen}
				onCancel={() => setRawConfigOpen(false)}
				onOk={saveRawConfig}
				okText="Apply config"
				confirmLoading={busy === "configuration apply"}
				width={900}
				destroyOnClose
			>
				<Alert
					className="mb-4"
					type="warning"
					showIcon
					message="Advanced YAML editor"
					description="The document must be a YAML object. LiteLLM rejects host, port, auth-dir, api-keys and remote-management because those fields define the private security boundary."
				/>
				<Input.TextArea
					value={rawConfigDraft}
					onChange={(event) => setRawConfigDraft(event.target.value)}
					autoSize={{ minRows: 22, maxRows: 36 }}
					className="font-mono"
					spellCheck={false}
				/>
			</Modal>

			<Modal
				title={`OAuth login: ${oauthSession?.provider ?? ""}`}
				open={oauthSession !== null}
				onCancel={() => setOAuthSession(null)}
				footer={[
					<Button key="close" onClick={() => setOAuthSession(null)}>
						Close
					</Button>,
				]}
				width={760}
			>
				<Tag color={oauthSession?.state === "succeeded" ? "green" : oauthSession?.state === "running" ? "blue" : "red"}>
					{oauthSession?.state}
				</Tag>
				<pre className="my-3 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-4 text-xs text-slate-100">
					{oauthSession?.output.join("\n") || "Waiting for CLIProxy login output..."}
				</pre>
				{oauthSession?.state === "running" && (
					<Space.Compact className="w-full">
						<Input
							value={oauthInput}
							onChange={(event) => setOAuthInput(event.target.value)}
							placeholder="Input requested by CLIProxy (if any)"
						/>
						<Button
							onClick={async () => {
								await api(`/cliproxy/oauth/${oauthSession.id}/input`, {
									method: "POST",
									body: JSON.stringify({ input: oauthInput }),
								});
								setOAuthInput("");
							}}
						>
							Send
						</Button>
					</Space.Compact>
				)}
			</Modal>
		</div>
	);
};

export default CliProxyManagement;
