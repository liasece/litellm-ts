import { computed, reactive, shallowRef } from "vue";
import { logsApi, type LogsApi } from "../api/LogsApi";
import { openLogsSocket } from "../api/LogsSocketApi";
import { createEmptyLogFilters, type LogFilterState } from "../logic/LogsFilterLogic";
import { localDateTime, subtractInterval } from "../logic/LogsDateLogic";
import { logsQuery } from "../logic/LogsQueryLogic";
import { readLogsUrlState, writeLogsUrlState, type LogsUrlState } from "../logic/LogsUrlLogic";
import { shareLogRows } from "../logic/LogsIdentityLogic";
import { createLiveTailScheduler } from "../logic/LiveTailSchedulerLogic";
import { DEFAULT_LIVE_TAIL_INTERVAL_MS, isLiveTailIntervalMs, QUICK_SELECT_OPTIONS } from "../support/LogsConstants";
import type { LogsPage, LogsSortField } from "../support/LogsModels";

interface LogsListOptions {
	scope: () => { userId: string; role: string };
	search?: string;
	writeUrl?: (params: URLSearchParams) => void;
	api?: Pick<LogsApi, "list">;
	socket?: typeof openLogsSocket;
}
function savedLiveSettings(): { enabled: boolean; interval: number } {
	if (typeof sessionStorage === "undefined") return { enabled: true, interval: DEFAULT_LIVE_TAIL_INTERVAL_MS };
	const savedInterval = Number(sessionStorage.getItem("liveTailIntervalMs"));
	const savedEnabled = sessionStorage.getItem("liveTailEnabled");
	let enabled = savedEnabled !== null ? savedEnabled !== "false" : savedInterval !== 0;
	if (savedEnabled === null && sessionStorage.getItem("liveTailIntervalMs") === null) {
		try {
			enabled = JSON.parse(sessionStorage.getItem("isLiveTail") ?? "true") !== false;
		} catch {
			enabled = true;
		}
	}
	return { enabled, interval: isLiveTailIntervalMs(savedInterval) && savedInterval > 0 ? savedInterval : DEFAULT_LIVE_TAIL_INTERVAL_MS };
}
export function createLogsListStore(options: LogsListOptions) {
	const api = options.api ?? logsApi;
	const initial = readLogsUrlState(options.search ?? "", {
		startTime: subtractInterval(24, "hours"),
		endTime: localDateTime(),
	});
	const live = savedLiveSettings();
	const state = reactive({
		...initial,
		activeTab: "request logs",
		loading: true,
		fetching: false,
		error: null as string | null,
		liveTailEnabled: live.enabled,
		liveTailIntervalMs: live.interval,
		connected: false,
	});
	const page = shallowRef<LogsPage>({ data: [], total: 0, page: 1, page_size: initial.pageSize, total_pages: 1 });
	let generation = 0,
		disposed = false,
		started = false,
		reconnectAttempt = 0,
		everConnected = false;
	let request: AbortController | null = null;
	let queued: ReturnType<typeof setTimeout> | null = null;
	let reconnect: ReturnType<typeof setTimeout> | null = null;
	let closeSocket: (() => void) | null = null;
	const scheduler = createLiveTailScheduler(() => refresh(false), state.liveTailIntervalMs);
	const liveActive = computed(() => state.liveTailEnabled && state.currentPage === 1 && state.activeTab === "request logs");
	const pageCount = computed(() => Math.max(1, page.value.total_pages));
	const range = computed(() => ({
		start: page.value.total > 0 ? (state.currentPage - 1) * state.pageSize + 1 : 0,
		end: Math.min(state.currentPage * state.pageSize, page.value.total),
		total: page.value.total,
	}));
	function urlState(): LogsUrlState {
		return state;
	}
	function syncUrl(): void {
		options.writeUrl?.(writeLogsUrlState(new URLSearchParams(options.search ?? ""), urlState()));
	}
	function clearQueued(): void {
		if (queued !== null) clearTimeout(queued);
		queued = null;
	}
	async function refresh(manual = true): Promise<void> {
		clearQueued();
		if (disposed || state.activeTab !== "request logs") return;
		const current = ++generation;
		request?.abort();
		request = new AbortController();
		state.fetching = manual;
		state.error = null;
		try {
			const next = await api.list(logsQuery(state, options.scope()), request.signal);
			if (disposed || generation !== current) return;
			page.value = shareLogRows(page.value, next);
		} catch (error: unknown) {
			if (!disposed && generation === current && !(error instanceof DOMException && error.name === "AbortError")) {
				state.error = error instanceof Error ? error.message : "Failed to fetch logs";
			}
		} finally {
			if (!disposed && generation === current) {
				state.loading = false;
				state.fetching = false;
			}
		}
	}
	function schedule(delay = 0): void {
		syncUrl();
		clearQueued();
		queued = setTimeout(() => {
			queued = null;
			void refresh();
		}, delay);
		reconcileLiveTail();
	}
	function scheduleReconnect(): void {
		if (disposed || !started || !liveActive.value || reconnect !== null) return;
		const delay = Math.min(1000 * 2 ** reconnectAttempt++, 30_000);
		reconnect = setTimeout(() => {
			reconnect = null;
			connect();
		}, delay);
	}
	function connect(): void {
		if (disposed || !started || !liveActive.value || closeSocket) return;
		try {
			closeSocket = (options.socket ?? openLogsSocket)("/spend/logs/ui/live", {
				open: () => {
					state.connected = true;
					reconnectAttempt = 0;
					if (everConnected) scheduler.signal();
					everConnected = true;
				},
				frame: (frame) => {
					if (frame.type === "logs_changed") scheduler.signal();
				},
				close: () => {
					state.connected = false;
					closeSocket?.();
					closeSocket = null;
					scheduleReconnect();
				},
			});
		} catch {
			closeSocket = null;
			scheduleReconnect();
		}
	}
	function stopConnection(): void {
		if (reconnect !== null) clearTimeout(reconnect);
		reconnect = null;
		closeSocket?.();
		closeSocket = null;
		state.connected = false;
		reconnectAttempt = 0;
		everConnected = false;
		scheduler.stop();
	}
	function reconcileLiveTail(): void {
		if (!started || !liveActive.value) {
			stopConnection();
			return;
		}
		scheduler.start();
		connect();
	}
	function persistLive(): void {
		try {
			sessionStorage.setItem("liveTailEnabled", String(state.liveTailEnabled));
			sessionStorage.setItem("liveTailIntervalMs", String(state.liveTailIntervalMs));
			sessionStorage.removeItem("isLiveTail");
		} catch {
			/* The live session still works without browser storage. */
		}
	}
	function setPage(value: number): void {
		state.currentPage = Math.max(1, value);
		schedule();
	}
	function setPageSize(value: number): void {
		state.pageSize = value;
		state.currentPage = 1;
		schedule();
	}
	function applyFilters(value: Partial<LogFilterState>): void {
		state.filters = { ...state.filters, ...value };
		state.currentPage = 1;
		schedule(300);
	}
	function clearFilters(): void {
		state.filters = createEmptyLogFilters();
		state.currentPage = 1;
		schedule(300);
	}
	function setSort(sortBy: LogsSortField, sortOrder: "asc" | "desc"): void {
		state.sortBy = sortBy;
		state.sortOrder = sortOrder;
		state.currentPage = 1;
		schedule();
	}
	function resetFilters(): void {
		Object.assign(state, {
			filters: createEmptyLogFilters(),
			currentPage: 1,
			startTime: subtractInterval(24, "hours"),
			endTime: localDateTime(),
			isCustomDate: false,
			selectedTimeInterval: { value: 24, unit: "hours" },
		});
		schedule();
	}
	function selectInterval(value: number, unit: string): void {
		if (!QUICK_SELECT_OPTIONS.some((option) => option.value === value && option.unit === unit)) return;
		Object.assign(state, {
			currentPage: 1,
			startTime: subtractInterval(value, unit),
			endTime: localDateTime(),
			selectedTimeInterval: { value, unit },
			isCustomDate: false,
		});
		schedule();
	}
	function setCustomDate(start: string, end: string, custom = true): void {
		Object.assign(state, { currentPage: 1, startTime: start, endTime: end, isCustomDate: custom });
		schedule();
	}
	function setLiveEnabled(value: boolean): void {
		state.liveTailEnabled = value;
		persistLive();
		reconcileLiveTail();
	}
	function setLiveInterval(value: number): void {
		if (!isLiveTailIntervalMs(value) || value <= 0) return;
		state.liveTailIntervalMs = value;
		scheduler.setInterval(value);
		persistLive();
	}
	function setTab(tab: string): void {
		state.activeTab = tab;
		if (tab !== "request logs") {
			generation++;
			request?.abort();
			clearQueued();
			state.fetching = false;
		}
		reconcileLiveTail();
		if (tab === "request logs") void refresh();
	}
	function restoreUrl(search: string): void {
		Object.assign(state, readLogsUrlState(search, { startTime: subtractInterval(24, "hours"), endTime: localDateTime() }));
		schedule();
	}
	function onVisible(): void {
		scheduler.wake();
	}
	function start(): void {
		if (started || disposed) return;
		started = true;
		syncUrl();
		persistLive();
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
		void refresh(false);
		reconcileLiveTail();
	}
	function dispose(): void {
		disposed = true;
		started = false;
		generation++;
		request?.abort();
		clearQueued();
		stopConnection();
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
	}
	return {
		state,
		page,
		range,
		pageCount,
		liveActive,
		start,
		refresh,
		setPage,
		setPageSize,
		applyFilters,
		clearFilters,
		setSort,
		resetFilters,
		selectInterval,
		setCustomDate,
		setLiveEnabled,
		setLiveInterval,
		setTab,
		restoreUrl,
		dispose,
	};
}
export type LogsListStore = ReturnType<typeof createLogsListStore>;
