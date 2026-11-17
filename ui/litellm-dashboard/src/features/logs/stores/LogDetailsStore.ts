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

/** 未结算详情仍会被流式补写，只做短缓存；已结算详情不再变化，可长期复用。 */
const IN_PROGRESS_CACHE_TIME_MS = 10 * 1000;
const MAX_CACHE_ENTRIES = 60;
interface DetailCacheEntry {
	payload: LogDetailsPayload;
	expires: number;
}
/** 详情 API 的最小能力；批量补缺是可选的，测试和嵌入场景可以只提供单条读取。 */
type LogDetailsApi = Pick<LogsApi, "detail"> & Partial<Pick<LogsApi, "detailsBatch">>;
export interface LogDetailsStoreOptions {
	api?: LogDetailsApi;
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
	const prefetching = new Set<string>();
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
	const keyFor = (requestId: string, nextStartDate: string) => JSON.stringify([requestId, nextStartDate]);
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
	function hasDetailData(payload: LogDetailsPayload): boolean {
		return payload !== null && Object.keys(payload).some((field) => field !== "request_id");
	}
	/**
	 * 写入详情缓存。
	 *
	 * 已结算详情是只读映射，不设过期；在途详情仍会变化，只保留一个轮询周期的短缓存，
	 * 避免 J/K 来回切换时重复读，也不会把半成品当成最终结果。
	 */
	function remember(payload: LogDetailsPayload, requestId = state.row?.request_id, nextStartDate = startDate) {
		if (!requestId || !nextStartDate || !hasDetailData(payload)) return;
		const cacheKey = keyFor(requestId, nextStartDate);
		cache.delete(cacheKey);
		cache.set(cacheKey, {
			payload,
			expires: payload?.status === "in_progress" ? now() + IN_PROGRESS_CACHE_TIME_MS : Number.POSITIVE_INFINITY,
		});
		while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value ?? "");
	}
	function readCache(requestId: string, nextStartDate: string): LogDetailsPayload | undefined {
		const cacheKey = keyFor(requestId, nextStartDate);
		const entry = cache.get(cacheKey);
		if (!entry) return undefined;
		if (entry.expires <= now()) {
			cache.delete(cacheKey);
			return undefined;
		}
		// Map 的插入顺序就是 LRU 顺序：命中后移到末尾，淘汰时从最旧开始。
		cache.delete(cacheKey);
		cache.set(cacheKey, entry);
		return entry.payload;
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
						// 终帧只是完成信号：不写入负载，结算后的内容由详情接口返回。
						frameVersion++;
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
	/**
	 * 批量补齐一组日志的只读详情，供 Session 中相邻行预取。
	 *
	 * 只写缓存，不改当前选中行：调用方仍按 bind 的既有流程切换详情。单条详情接口
	 * 仍作为实时/未命中兜底；批量接口只负责按已知 request_id 补缺，负载能否长期复用
	 * 由 remember 按结算状态决定。
	 * @param rows - 需要补齐的日志行，按 request_id 去重
	 * @param nextStartDate - 与详情 API 一致的时间窗起点
	 * @param excludeRequestId - 当前选中行；它由 bind 走单条接口，避免和批量预取重复
	 */
	async function prefetch(rows: readonly LogEntry[], nextStartDate: string, excludeRequestId?: string): Promise<void> {
		const batch = api.detailsBatch;
		if (!batch || !nextStartDate) return;
		const missing: { request_id: string; start_date: string }[] = [];
		const seen = new Set<string>();
		for (const row of rows) {
			const requestId = row.request_id;
			if (
				!requestId ||
				requestId === excludeRequestId ||
				seen.has(requestId) ||
				prefetching.has(requestId) ||
				readCache(requestId, nextStartDate)
			)
				continue;
			seen.add(requestId);
			missing.push({ request_id: requestId, start_date: nextStartDate });
		}
		for (let offset = 0; offset < missing.length; offset += 100) {
			const chunk = missing.slice(offset, offset + 100);
			for (const request of chunk) prefetching.add(request.request_id);
			try {
				const payloads = await batch(chunk);
				for (const payload of payloads) {
					if (!isLogDetailPatch(payload)) continue;
					const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
					if (requestId) remember(payload, requestId, nextStartDate);
				}
			} catch {
				// 预取失败不影响当前详情；选中该行时 bind 会走单条接口重试。
			} finally {
				for (const request of chunk) prefetching.delete(request.request_id);
			}
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
		state.payload = readCache(row.request_id, nextStartDate);
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
	return { state, enriched, inProgress, bind, prefetch, refresh, close, dispose };
}
export type LogDetailsStore = ReturnType<typeof createLogDetailsStore>;
