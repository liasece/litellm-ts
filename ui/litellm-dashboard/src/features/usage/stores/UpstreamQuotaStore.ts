import { reactive } from "vue";
import { createRefreshScheduler, type RefreshSchedulerEnvironment } from "../../platform/logic/RefreshSchedulerLogic";
import { upstreamQuotaApi, type UpstreamAccount, type AccountQuota, type BuiltInQuotaAccount } from "../api/UpstreamQuotaApi";
import {
	readUpstreamQuotaCache,
	resolveUpstreamQuotaStorage,
	writeUpstreamQuotaCache,
	type UpstreamQuotaStorage,
} from "../data/UpstreamQuotaCacheData";
interface QuotaState {
	status: "loading" | "success" | "error";
	data?: AccountQuota;
	error?: string;
}
function describe(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
/**
 * 自动刷新间隔：订阅账号的额度查询每次都穿透到上游（服务端没有缓存），按日志页那种
 * 秒级频率轮询会持续消耗各家的额度接口，因此按分钟级；切回标签页时调度器会立即补一次。
 */
export const UPSTREAM_QUOTA_POLL_INTERVAL_MS = 5 * 60 * 1000;
export interface UpstreamQuotaStoreOptions {
	/** 轮询间隔，测试用它缩短等待。 */
	interval?: number;
	/** 定时器与可见性来源，测试注入假实现即可确定性地验证暂停与补刷。 */
	environment?: RefreshSchedulerEnvironment;
}
/**
 * 上游账号额度：先用缓存快照铺满表格，再在后台请求真实数值。
 *
 * - 打开时同步读取上次成功的快照，因此不为空白页等待；刷新过程只体现在 Refresh 按钮的加载态。
 * - 请求成功就整体覆盖并重写快照；单个账号失败保留它上一次的数值，同时把错误写在
 *   这一行上，避免“有旧数字就当成功”的假象。
 * - 账号列表请求失败同样保留缓存行，并把原因交给页面显示。
 */
export function createUpstreamQuotaStore(
	api = upstreamQuotaApi,
	storage: UpstreamQuotaStorage | null = resolveUpstreamQuotaStorage(),
	options: UpstreamQuotaStoreOptions = {},
) {
	const cached = readUpstreamQuotaCache(storage);
	const state = reactive({
		accounts: (cached?.accounts ?? []) as UpstreamAccount[],
		providers: (cached?.providers ?? []) as BuiltInQuotaAccount[],
		quotas: (cached
			? Object.fromEntries(Object.entries(cached.quotas).map(([index, data]) => [index, { status: "success", data }]))
			: {}) as Record<string, QuotaState>,
		accountsError: null as string | null,
		builtInError: null as string | null,
		refreshing: false,
	});
	let generation = 0,
		disposed = false,
		started = false,
		controller: AbortController | null = null;
	// 轮询和手动刷新走同一条路径：保留先前的数值，只在拿到新数据后整体替换；顺带刷新账号列表，
	// 长时间开着的页面也能看到新加的账号。
	const scheduler = createRefreshScheduler(() => load(), options.interval ?? UPSTREAM_QUOTA_POLL_INTERVAL_MS, options.environment);
	async function quotas(accounts: UpstreamAccount[], signal: AbortSignal, current: number) {
		const previous = state.quotas;
		let refreshed = false;
		state.quotas = Object.fromEntries(
			accounts.map((account) => [account.auth_index, { status: "loading", data: previous[account.auth_index]?.data }]),
		);
		const entries = await Promise.all(
			accounts.map(async (account) => {
				try {
					const data = await api.quota(account.auth_index, signal);
					refreshed = true;
					return [account.auth_index, { status: "success", data }] as const;
				} catch (error: unknown) {
					// 失败保留上一次的数值，错误照实挂在这一行，两者一起交给页面。
					return [
						account.auth_index,
						{ status: "error", error: describe(error), data: previous[account.auth_index]?.data },
					] as const;
				}
			}),
		);
		if (!disposed && current === generation && !signal.aborted) state.quotas = Object.fromEntries(entries);
		return refreshed;
	}
	async function builtIn(force: boolean, signal: AbortSignal, current: number) {
		try {
			const data = await api.builtIn(force, signal);
			if (!disposed && current === generation && !signal.aborted) {
				state.providers = data;
				state.builtInError = null;
				return true;
			}
		} catch (error: unknown) {
			// 只更新错误信息：表里仍是缓存或上一次的数值，其时间由行上的 Updated 说明。
			if (!disposed && current === generation && !signal.aborted) state.builtInError = describe(error);
		}
		return false;
	}
	/**
	 * 只有真的拿到了新数值才重写快照：整轮失败时保留旧快照，下次打开不会把旧数据
	 * 当成刚刷新过的结果。刷新过程本身只体现在 Refresh 按钮的加载态，不另加提示条。
	 */
	function persist(quotasRefreshed: boolean, providersRefreshed: boolean) {
		if (!quotasRefreshed && !(providersRefreshed && !state.accounts.length)) return;
		const entries = Object.entries(state.quotas).filter(([, entry]) => entry.data);
		writeUpstreamQuotaCache(storage, {
			accounts: state.accounts,
			providers: state.providers,
			quotas: Object.fromEntries(entries.map(([index, entry]) => [index, entry.data as AccountQuota])),
		});
	}
	async function load(refresh = false) {
		if (disposed) return;
		const current = ++generation;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		state.refreshing = true;
		let quotasRefreshed = false;
		const cli = async () => {
			if (refresh) {
				if (state.accounts.length) quotasRefreshed = await quotas(state.accounts, request.signal, current);
				return;
			}
			try {
				const accounts = await api.accounts(request.signal);
				if (disposed || current !== generation || request.signal.aborted) return;
				state.accounts = accounts;
				state.accountsError = null;
				if (accounts.length) quotasRefreshed = await quotas(accounts, request.signal, current);
			} catch (error: unknown) {
				// 列表失败时保留缓存里的账号行，页面同时显示真实原因。
				if (!disposed && current === generation && !request.signal.aborted) state.accountsError = describe(error);
			}
		};
		// 内置 key 与订阅账号并行拉取，互不等待；两边都自己吞掉错误，用返回值说明是否刷新成功。
		const [, providersRefreshed] = await Promise.all([cli(), builtIn(refresh, request.signal, current)]);
		if (disposed || current !== generation) return;
		state.refreshing = false;
		controller = null;
		persist(quotasRefreshed, providersRefreshed);
	}
	/** 页面可见性恢复时补一次刷新：隐藏期间的轮询被跳过，回来不该继续看旧数字。 */
	function wake() {
		scheduler.wake();
	}
	function start() {
		if (disposed) return;
		void load();
		if (started) return;
		started = true;
		scheduler.start();
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);
	}
	function dispose() {
		disposed = true;
		generation++;
		started = false;
		scheduler.stop();
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", wake);
		controller?.abort();
	}
	return { state, load, start, wake, dispose };
}
