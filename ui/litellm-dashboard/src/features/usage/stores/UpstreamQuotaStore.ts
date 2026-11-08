import { reactive } from "vue";
import { upstreamQuotaApi, type UpstreamAccount, type AccountQuota, type BuiltInQuotaAccount } from "../api/UpstreamQuotaApi";
interface QuotaState {
	status: "loading" | "success" | "error";
	data?: AccountQuota;
	error?: string;
}
export function createUpstreamQuotaStore(api = upstreamQuotaApi) {
	const state = reactive({
		accounts: [] as UpstreamAccount[],
		providers: [] as BuiltInQuotaAccount[],
		quotas: {} as Record<string, QuotaState>,
		builtInError: null as string | null,
		refreshing: false,
	});
	let generation = 0,
		disposed = false,
		controller: AbortController | null = null;
	async function quotas(accounts: UpstreamAccount[], signal: AbortSignal, current: number) {
		state.quotas = Object.fromEntries(
			accounts.map((a) => [a.auth_index, { status: "loading", data: state.quotas[a.auth_index]?.data }]),
		);
		const entries = await Promise.all(
			accounts.map(async (a) => {
				try {
					const data = await api.quota(a.auth_index, signal);
					return [a.auth_index, { status: "success", data }] as const;
				} catch (error: unknown) {
					return [a.auth_index, { status: "error", error: error instanceof Error ? error.message : String(error) }] as const;
				}
			}),
		);
		if (!disposed && current === generation && !signal.aborted) state.quotas = Object.fromEntries(entries);
	}
	async function builtIn(force: boolean, signal: AbortSignal, current: number) {
		try {
			const data = await api.builtIn(force, signal);
			if (!disposed && current === generation && !signal.aborted) {
				state.providers = data;
				state.builtInError = null;
			}
		} catch (error: unknown) {
			if (!disposed && current === generation && !signal.aborted) {
				state.providers = [];
				state.builtInError = error instanceof Error ? error.message : String(error);
			}
		}
	}
	async function load(refresh = false) {
		if (disposed) return;
		const current = ++generation;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		state.refreshing = true;
		const cli = async () => {
			if (refresh) {
				if (state.accounts.length) await quotas(state.accounts, request.signal, current);
				return;
			}
			try {
				const accounts = await api.accounts(request.signal);
				if (disposed || current !== generation || request.signal.aborted) return;
				state.accounts = accounts;
				if (accounts.length) await quotas(accounts, request.signal, current);
			} catch {
				if (!disposed && current === generation && !request.signal.aborted) state.accounts = [];
			}
		};
		await Promise.allSettled([cli(), builtIn(refresh, request.signal, current)]);
		if (!disposed && current === generation) {
			state.refreshing = false;
			controller = null;
		}
	}
	function dispose() {
		disposed = true;
		generation++;
		controller?.abort();
	}
	return { state, load, dispose };
}
