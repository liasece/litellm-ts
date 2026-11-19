import { reactive } from "vue";
import { cliProxyApi } from "../api/CliProxyApi";
import type {
	Account,
	AccountQuota,
	AccountQuotaState,
	CommandCodeAccount,
	CliProxyLogEntry,
	OAuthSession,
	RuntimeStatus,
} from "../support/CliProxyModels";

export function createCliProxyStore() {
	const state = reactive({
		status: null as RuntimeStatus | null,
		accounts: [] as Account[],
		commandCodeAccounts: [] as CommandCodeAccount[],
		commandCodeLabel: "",
		commandCodeKey: "",
		editingCommandCode: null as CommandCodeAccount | null,
		editingCommandCodeLabel: "",
		editingCommandCodeKey: "",
		logs: [] as CliProxyLogEntry[],
		logCursor: 0,
		loading: true,
		busy: null as string | null,
		activeTab: "overview",
		oauthSession: null as OAuthSession | null,
		oauthInput: "",
		quotaStates: {} as Record<string, AccountQuotaState>,
		notice: null as { type: "error" | "success"; message: string } | null,
	});
	let disposed = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let logsFetchInFlight: number | null = null;
	let quotaLoadedOnce = false;
	let logsRequestGeneration = 0;
	const notify = (type: "error" | "success", message: string) => {
		if (disposed) return;
		state.notice = { type, message };
		window.dispatchEvent(new CustomEvent("litellm-notification", { detail: { type, message } }));
	};
	const fail = (error: unknown) => notify("error", error instanceof Error ? error.message : String(error));
	const refreshStatus = async () => {
		const value = await cliProxyApi<RuntimeStatus>("/subscriptions/status");
		if (!disposed) state.status = value;
	};
	const refreshAccounts = async () => {
		const value = await cliProxyApi<{ data: Account[] }>("/subscriptions/accounts?include_trashed=true");
		if (!disposed) {
			state.accounts = value.data;
			if (state.accounts.length && !quotaLoadedOnce) {
				quotaLoadedOnce = true;
				void refreshAllQuotas();
			}
		}
	};
	const refreshCommandCodeAccounts = async () => {
		const value = await cliProxyApi<{ data: CommandCodeAccount[] }>("/subscriptions/commandcode/accounts");
		if (!disposed) state.commandCodeAccounts = value.data;
	};
	const refreshLogs = async () => {
		if (logsFetchInFlight !== null && Date.now() - logsFetchInFlight < 10_000) return;
		const request = Date.now();
		const generation = ++logsRequestGeneration;
		logsFetchInFlight = request;
		try {
			const value = await cliProxyApi<{ entries: CliProxyLogEntry[]; cursor: number }>(
				"/subscriptions/logs?after=" + state.logCursor,
			);
			if (!disposed && generation === logsRequestGeneration) {
				state.logCursor = value.cursor;
				if (value.entries.length) state.logs = [...state.logs, ...value.entries].slice(-2000);
			}
		} finally {
			if (logsFetchInFlight === request) logsFetchInFlight = null;
		}
	};
	const reloadLogs = async () => {
		state.busy = "logs refresh";
		const generation = ++logsRequestGeneration;
		try {
			const value = await cliProxyApi<{ entries: CliProxyLogEntry[]; cursor: number }>("/subscriptions/logs");
			if (!disposed && generation === logsRequestGeneration) {
				state.logs = value.entries;
				state.logCursor = value.cursor;
			}
		} catch (error) {
			fail(error);
		} finally {
			if (!disposed) state.busy = null;
		}
	};
	const loadQuota = async (account: Account) => {
		const previous = state.quotaStates[account.auth_index]?.data;
		state.quotaStates[account.auth_index] = { status: "loading", data: previous };
		try {
			const value = await cliProxyApi<AccountQuota>("/subscriptions/accounts/" + encodeURIComponent(account.auth_index) + "/quota");
			const email = value.email?.trim();
			if (email) {
				const target = state.accounts.find((candidate) => candidate.auth_index === account.auth_index);
				if (target) target.email = email;
			}
			if (!disposed) state.quotaStates[account.auth_index] = { status: "success", data: value };
		} catch (error) {
			if (!disposed)
				state.quotaStates[account.auth_index] = {
					status: "error",
					data: previous,
					error: error instanceof Error ? error.message : String(error),
				};
		}
	};
	const refreshAllQuotas = async () => {
		await Promise.all(state.accounts.filter((account) => !account.trashed).map(loadQuota));
	};
	const load = async () => {
		state.loading = true;
		try {
			const [status, accounts, managed, logs] = await Promise.all([
				cliProxyApi<RuntimeStatus>("/subscriptions/status"),
				cliProxyApi<{ data: Account[] }>("/subscriptions/accounts?include_trashed=true"),
				cliProxyApi<{ data: CommandCodeAccount[] }>("/subscriptions/commandcode/accounts"),
				cliProxyApi<{ entries: CliProxyLogEntry[]; cursor: number }>("/subscriptions/logs"),
			]);
			if (disposed) return;
			state.status = status;
			state.accounts = accounts.data;
			state.commandCodeAccounts = managed.data;
			state.logs = logs.entries;
			state.logCursor = logs.cursor;
			if (state.accounts.length && !quotaLoadedOnce) {
				quotaLoadedOnce = true;
				void refreshAllQuotas();
			}
		} catch (error) {
			fail(error);
		} finally {
			if (!disposed) state.loading = false;
		}
	};
	const startOAuth = async (provider: string) => {
		state.busy = "oauth-" + provider;
		try {
			state.oauthSession = await cliProxyApi<OAuthSession>("/subscriptions/oauth", {
				method: "POST",
				body: JSON.stringify({ provider }),
			});
		} catch (error) {
			fail(error);
		} finally {
			state.busy = null;
		}
	};
	const sendOAuthInput = async () => {
		if (!state.oauthSession) return;
		try {
			await cliProxyApi("/subscriptions/oauth/" + state.oauthSession.id + "/input", {
				method: "POST",
				body: JSON.stringify({ input: state.oauthInput }),
			});
			state.oauthInput = "";
		} catch (error) {
			fail(error);
		}
	};
	const addCommandCodeAccount = async () => {
		state.busy = "add commandcode account";
		try {
			await cliProxyApi("/subscriptions/commandcode/accounts", {
				method: "POST",
				body: JSON.stringify({ api_key: state.commandCodeKey, label: state.commandCodeLabel }),
			});
			state.commandCodeKey = "";
			state.commandCodeLabel = "";
			await Promise.all([refreshAccounts(), refreshCommandCodeAccounts()]);
			notify("success", "CommandCode account added");
		} catch (error) {
			fail(error);
		} finally {
			state.busy = null;
		}
	};
	const editCommandCodeAccount = (account: CommandCodeAccount) => {
		state.editingCommandCode = account;
		state.editingCommandCodeLabel = account.label;
		state.editingCommandCodeKey = "";
	};
	const saveCommandCodeAccount = async () => {
		if (!state.editingCommandCode) return;
		state.busy = "edit commandcode account";
		try {
			const payload: Record<string, string> = { label: state.editingCommandCodeLabel };
			if (state.editingCommandCodeKey.trim()) payload.api_key = state.editingCommandCodeKey;
			await cliProxyApi("/subscriptions/commandcode/accounts/" + state.editingCommandCode.index, {
				method: "PATCH",
				body: JSON.stringify(payload),
			});
			state.editingCommandCode = null;
			state.editingCommandCodeKey = "";
			await Promise.all([refreshAccounts(), refreshCommandCodeAccounts()]);
			notify("success", "CommandCode account updated");
		} catch (error) {
			fail(error);
		} finally {
			state.busy = null;
		}
	};
	const updateAccount = async (account: Account, changes: Record<string, unknown>) => {
		try {
			await cliProxyApi("/subscriptions/accounts/" + encodeURIComponent(account.auth_index), {
				method: "PATCH",
				body: JSON.stringify(changes),
			});
			await refreshAccounts();
		} catch (error) {
			fail(error);
		}
	};
	const accountName = (account: Account) => account.email?.trim() || account.label?.trim() || account.key;
	const removeAccount = async (account: Account) => {
		const managed = state.commandCodeAccounts.find((item) => item.key === account.key);
		try {
			if (managed) {
				await cliProxyApi("/subscriptions/commandcode/accounts/" + managed.index, { method: "DELETE" });
				notify("success", "CommandCode account " + managed.label + " deleted");
				await Promise.all([refreshAccounts(), refreshCommandCodeAccounts()]);
			} else {
				const trashed = account.trashed === true;
				await cliProxyApi("/subscriptions/accounts/" + encodeURIComponent(account.auth_index) + (trashed ? "/restore" : ""), {
					method: trashed ? "POST" : "DELETE",
				});
				notify("success", "Account " + accountName(account) + (trashed ? " restored" : " moved to trash"));
				await refreshAccounts();
			}
		} catch (error) {
			fail(error);
		}
	};
	/** 彻底删除：只对回收站里的账号开放，连同配置里的来源一起删除，避免下次投影重建。 */
	const purgeAccount = async (account: Account) => {
		const managed = state.commandCodeAccounts.some((item) => item.key === account.key);
		try {
			await cliProxyApi("/subscriptions/accounts/" + encodeURIComponent(account.auth_index) + "/purge", { method: "DELETE" });
			notify("success", "Account " + accountName(account) + " permanently deleted");
			await Promise.all([refreshAccounts(), managed ? refreshCommandCodeAccounts() : Promise.resolve()]);
		} catch (error) {
			fail(error);
		}
	};
	const poll = async () => {
		void refreshStatus().catch(() => undefined);
		void refreshLogs().catch(() => undefined);
		const session = state.oauthSession;
		if (session?.state === "running") {
			try {
				const value = await cliProxyApi<OAuthSession>("/subscriptions/oauth/" + session.id);
				if (disposed || state.oauthSession?.id !== session.id) return;
				state.oauthSession = value;
				if (value.state !== "running") await refreshAccounts();
			} catch {
				/* The next poll retries while the existing output stays visible. */
			}
		}
	};
	const start = () => {
		disposed = false;
		void load();
		timer = setInterval(() => void poll(), 2000);
	};
	const dispose = () => {
		disposed = true;
		if (timer) clearInterval(timer);
	};
	return {
		state,
		start,
		dispose,
		load,
		refreshAccounts,
		refreshCommandCodeAccounts,
		refreshLogs,
		reloadLogs,
		refreshAllQuotas,
		loadQuota,
		startOAuth,
		sendOAuthInput,
		addCommandCodeAccount,
		editCommandCodeAccount,
		saveCommandCodeAccount,
		updateAccount,
		removeAccount,
		purgeAccount,
	};
}
export type CliProxyStore = ReturnType<typeof createCliProxyStore>;
