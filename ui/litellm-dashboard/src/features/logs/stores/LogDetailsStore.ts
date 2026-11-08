import { computed, shallowReactive } from "vue";
import { logsApi, type LogsApi } from "../api/LogsApi";
import { openLogDetailsSocket, type LogDetailsSocketFactory } from "../api/LogDetailsSocketApi";
import {
	isDetailInProgress,
	isLogEntryInProgress,
	LOG_DETAILS_POLL_INTERVAL_MS,
	mergeLogDetails,
	shouldPollLogDetails,
	type LogDetailsPayload,
} from "../logic/LogDetailsMergeLogic";
import { isLogDetailPatch } from "../data/LogDetailsPayloadData";
import type { LogEntry } from "../support/LogsModels";

const CACHE_TIME_MS = 10 * 60 * 1000;
interface DetailCacheEntry {
	payload: LogDetailsPayload;
	expires: number;
}
export interface LogDetailsStoreOptions {
	api?: Pick<LogsApi, "detail">;
	socket?: LogDetailsSocketFactory;
	settled?: () => void;
	now?: () => number;
}
export function createLogDetailsStore(options: LogDetailsStoreOptions = {}) {
	const api = options.api ?? logsApi;
	const socketFactory = options.socket ?? openLogDetailsSocket;
	const now = options.now ?? Date.now;
	const state = shallowReactive({
		row: null as LogEntry | null,
		payload: undefined as LogDetailsPayload | undefined,
		loading: false,
		refreshing: false,
		streaming: false,
		error: null as string | null,
	});
	const enriched = computed(() => mergeLogDetails(state.row, state.payload));
	const inProgress = computed(() => isDetailInProgress(state.row, state.payload));
	const cache = new Map<string, DetailCacheEntry>();
	let enabled = false;
	let startDate = "";
	let epoch = 0;
	let frameVersion = 0;
	let notifiedSettled = false;
	let finalRefreshPending = false;
	let inFlight: Promise<void> | null = null;
	let controller: AbortController | null = null;
	let stopSocket: (() => void) | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	const key = () => (state.row ? JSON.stringify([state.row.request_id, startDate]) : "");
	function clearPoll() {
		if (pollTimer !== null) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}
	function disconnect() {
		const stop = stopSocket;
		stopSocket = null;
		stop?.();
		state.streaming = false;
	}
	function remember(payload: LogDetailsPayload) {
		cache.set(key(), { payload, expires: now() + CACHE_TIME_MS });
		for (const [cacheKey, entry] of cache) if (entry.expires <= now()) cache.delete(cacheKey);
		if (cache.size > 100) cache.delete(cache.keys().next().value ?? "");
	}
	function notifySettled() {
		if (!notifiedSettled) {
			notifiedSettled = true;
			options.settled?.();
		}
	}
	function updatePolling() {
		clearPoll();
		if (!enabled || !state.row || !shouldPollLogDetails(state.payload, state.streaming, isLogEntryInProgress(state.row))) return;
		pollTimer = setTimeout(() => {
			pollTimer = null;
			void refresh().finally(updatePolling);
		}, LOG_DETAILS_POLL_INTERVAL_MS);
	}
	async function refresh(): Promise<void> {
		if (!enabled || !state.row || !startDate) return;
		if (inFlight) return inFlight;
		const selectedEpoch = epoch;
		const requestId = state.row.request_id;
		const version = frameVersion;
		const requestController = new AbortController();
		controller = requestController;
		state.loading = state.payload === undefined;
		state.refreshing = true;
		state.error = null;
		const request = (async () => {
			try {
				const payload = await api.detail(requestId, startDate, requestController.signal);
				if (!enabled || selectedEpoch !== epoch || requestController.signal.aborted) return;
				if (payload !== null && !isLogDetailPatch(payload)) throw new Error("Invalid log detail response");
				const settledPayload = payload !== null && payload.status !== "in_progress";
				if (version !== frameVersion) return;
				state.payload = payload;
				remember(payload);
				if (settledPayload) {
					disconnect();
					if (isLogEntryInProgress(state.row)) notifySettled();
				}
			} catch (error) {
				if (selectedEpoch === epoch && enabled && !requestController.signal.aborted)
					state.error = error instanceof Error ? error.message : String(error);
			} finally {
				if (selectedEpoch === epoch) {
					state.loading = false;
					state.refreshing = false;
					if (controller === requestController) controller = null;
				}
			}
		})();
		inFlight = request;
		void request.finally(() => {
			if (inFlight === request) {
				inFlight = null;
				if (finalRefreshPending) {
					finalRefreshPending = false;
					void refresh();
				} else updatePolling();
			}
		});
		return request;
	}
	function refreshFinal() {
		if (inFlight) finalRefreshPending = true;
		else void refresh();
	}
	function connect() {
		if (!enabled || !state.row || !isLogEntryInProgress(state.row) || (state.payload != null && state.payload.status !== "in_progress"))
			return;
		const selectedEpoch = epoch;
		const requestId = state.row.request_id;
		try {
			stopSocket = socketFactory(requestId, {
				open: () => {
					if (selectedEpoch === epoch && enabled) {
						state.streaming = true;
						updatePolling();
					}
				},
				frame: (frame) => {
					if (selectedEpoch !== epoch || !enabled) return;
					if (frame.request_id !== undefined && frame.request_id !== requestId) {
						disconnect();
						updatePolling();
						return;
					}
					const data = frame.data;
					const record = isLogDetailPatch(data) ? data : null;
					if (frame.type === "snapshot" && record) {
						frameVersion++;
						state.payload = record;
						remember(record);
						updatePolling();
					} else if (frame.type === "patch" && record) {
						frameVersion++;
						state.payload = { ...(state.payload ?? {}), ...record };
						remember(state.payload);
						updatePolling();
					} else if (frame.type === "final") {
						frameVersion++;
						state.payload = record;
						remember(record);
						disconnect();
						notifySettled();
						refreshFinal();
					} else if (frame.type === "gone") {
						disconnect();
						notifySettled();
						refreshFinal();
					} else if (frame.type === "timeout" || frame.type === "error") {
						disconnect();
						updatePolling();
					}
				},
				close: () => {
					if (selectedEpoch === epoch && enabled) {
						disconnect();
						updatePolling();
					}
				},
			});
		} catch {
			state.streaming = false;
			updatePolling();
		}
	}
	function bind(row: LogEntry | null, nextStartDate: string, open = true) {
		const nextEnabled = Boolean(open && row && nextStartDate);
		const same = nextEnabled && enabled && row?.request_id === state.row?.request_id && startDate === nextStartDate;
		if (same) {
			const wasInProgress = isLogEntryInProgress(state.row);
			state.row = row;
			if (wasInProgress && !isLogEntryInProgress(row)) {
				disconnect();
				refreshFinal();
			}
			updatePolling();
			return;
		}
		close();
		if (!nextEnabled || !row) return;
		enabled = true;
		startDate = nextStartDate;
		state.row = row;
		notifiedSettled = false;
		const cached = cache.get(key());
		state.payload = cached && cached.expires > now() ? cached.payload : undefined;
		state.loading = state.payload === undefined;
		connect();
		if (state.payload === undefined) void refresh();
		updatePolling();
	}
	function close() {
		enabled = false;
		epoch++;
		frameVersion = 0;
		finalRefreshPending = false;
		clearPoll();
		disconnect();
		controller?.abort();
		controller = null;
		inFlight = null;
		state.row = null;
		state.payload = undefined;
		state.loading = false;
		state.refreshing = false;
		state.error = null;
	}
	function dispose() {
		close();
		cache.clear();
	}
	return { state, enriched, inProgress, bind, refresh, close, dispose };
}
export type LogDetailsStore = ReturnType<typeof createLogDetailsStore>;
