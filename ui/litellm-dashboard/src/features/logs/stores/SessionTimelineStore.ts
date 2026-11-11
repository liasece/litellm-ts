import { computed, shallowReactive } from "vue";
import {
	openSessionTimelineSocket,
	parseSessionTimeline,
	parseSessionTimelineUpdate,
	sessionTimelineApi,
	type SessionTimelineApi,
	type TimelineSocketFactory,
} from "../api/SessionTimelineApi";
import { applySessionTimelineUpdate, safeSessionError } from "../logic/SessionTimelineMergeLogic";
import type { SessionGroupRef } from "../support/LogsModels";
import type { SessionTimelineEvent, SessionTimelineResponse } from "../support/SessionTimelineModels";
export function createSessionTimelineStore(options: { api?: SessionTimelineApi; socket?: TimelineSocketFactory } = {}) {
	const api = options.api ?? sessionTimelineApi;
	const socketFactory = options.socket ?? openSessionTimelineSocket;
	const state = shallowReactive({
		response: undefined as SessionTimelineResponse | undefined,
		earlier: [] as SessionTimelineEvent[],
		later: [] as SessionTimelineEvent[],
		loading: false,
		refreshing: false,
		streaming: false,
		error: null as string | null,
		loadingEarlier: false,
		loadingLater: false,
		earlierError: null as string | null,
		laterError: null as string | null,
		newestFirst: true,
		earlierHasMore: false,
		earlierLoaded: false,
		laterHasMore: false,
		laterLoaded: false,
	});
	let group: SessionGroupRef | null = null,
		teamId: string | undefined,
		enabled = false,
		epoch = 0,
		version = 0;
	let stopSocket: (() => void) | null = null,
		retryTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempt = 0,
		serverTimedOut = false,
		earlierCursor: string | null = null,
		laterCursor: string | null = null;
	let controller: AbortController | null = null,
		earlierController: AbortController | null = null,
		laterController: AbortController | null = null,
		inFlight: Promise<void> | null = null;
	const combined = computed(() => {
		const values = [
			...state.earlier,
			...(state.response?.data ?? []),
			...state.later,
			// 最早优先是历史回放：在途请求属于尚未加载的尾部，不混进当前页。
			...(state.newestFirst ? (state.response?.active_requests ?? []).flatMap((request) => request.events) : []),
		];
		const byId = new Map(values.map((event) => [event.id, event]));
		return [...byId.values()];
	});
	const displayed = computed(() => (state.newestFirst ? [...combined.value].reverse() : combined.value));
	const canLoadEarlier = computed(
		() => state.newestFirst && (state.earlierHasMore || (!state.earlierLoaded && Boolean(state.response?.window?.has_more))),
	);
	const canLoadLater = computed(
		() => !state.newestFirst && (state.laterHasMore || (!state.laterLoaded && Boolean(state.response?.window?.has_more))),
	);
	/**
	 * 按当前排序读取第一页。
	 *
	 * 最新优先读取最新窗口，继续向更早翻页；最早优先读取最早的窗口，继续向更新翻页。
	 * 最早优先不叠加实时在途请求：那些请求属于尚未加载的尾部，等读者翻到尾部或切回最新。
	 */
	async function refresh() {
		if (!enabled || !group) return;
		if (inFlight) return inFlight;
		const forward = !state.newestFirst,
			selectedEpoch = epoch,
			selectedVersion = version,
			selectedGroup = group,
			requestController = new AbortController();
		controller = requestController;
		state.loading = state.response === undefined;
		state.refreshing = true;
		state.error = null;
		const request = (async () => {
			try {
				const response = await api.fetch(
					selectedGroup,
					teamId,
					forward ? { direction: "forward", signal: requestController.signal } : { signal: requestController.signal },
				);
				if (selectedEpoch === epoch && enabled && !requestController.signal.aborted && selectedVersion === version) {
					if (forward) {
						state.response = { ...response, active_requests: [] };
						state.later = [];
						laterCursor = response.window?.after ?? null;
						state.laterHasMore = response.window?.has_more ?? false;
						state.laterLoaded = true;
					} else state.response = response;
				}
			} catch (error) {
				if (selectedEpoch === epoch && !requestController.signal.aborted)
					state.error = safeSessionError(error, "Session 历史加载失败");
			} finally {
				if (selectedEpoch === epoch && controller === requestController) {
					state.loading = false;
					state.refreshing = false;
					controller = null;
				}
			}
		})();
		inFlight = request;
		void request.finally(() => {
			if (inFlight === request) inFlight = null;
		});
		return request;
	}
	async function loadEarlier() {
		const cursor = earlierCursor ?? state.response?.window?.before;
		if (!enabled || !group || !cursor || state.loadingEarlier || !state.newestFirst) return;
		const selectedEpoch = epoch,
			selectedVersion = version,
			requestController = new AbortController();
		earlierController = requestController;
		state.loadingEarlier = true;
		state.earlierError = null;
		try {
			const page = await api.fetch(group, teamId, { before: cursor, signal: requestController.signal });
			if (selectedEpoch !== epoch || selectedVersion !== version || requestController.signal.aborted) return;
			state.earlier = [...page.data, ...state.earlier];
			earlierCursor = page.window?.before ?? null;
			state.earlierHasMore = page.window?.has_more ?? false;
			state.earlierLoaded = true;
		} catch (error) {
			if (selectedEpoch === epoch && !requestController.signal.aborted)
				state.earlierError = safeSessionError(error, "加载更早的请求失败", 200);
		} finally {
			if (selectedEpoch === epoch && earlierController === requestController) {
				state.loadingEarlier = false;
				earlierController = null;
			}
		}
	}
	/**
	 * 最早优先时追加更新的一页。
	 *
	 * 与 `loadEarlier` 对称：按 `after` 游标从上一页最后一条请求之后继续，追加在时间线尾部。
	 */
	async function loadLater() {
		const cursor = laterCursor ?? state.response?.window?.after;
		if (!enabled || !group || !cursor || state.loadingLater || state.newestFirst) return;
		const selectedEpoch = epoch,
			selectedVersion = version,
			requestController = new AbortController();
		laterController = requestController;
		state.loadingLater = true;
		state.laterError = null;
		try {
			const page = await api.fetch(group, teamId, {
				direction: "forward",
				after: cursor,
				signal: requestController.signal,
			});
			if (selectedEpoch !== epoch || selectedVersion !== version || requestController.signal.aborted) return;
			state.later = [...state.later, ...page.data];
			laterCursor = page.window?.after ?? null;
			state.laterHasMore = page.window?.has_more ?? false;
			state.laterLoaded = true;
		} catch (error) {
			if (selectedEpoch === epoch && !requestController.signal.aborted)
				state.laterError = safeSessionError(error, "加载更新的请求失败", 200);
		} finally {
			if (selectedEpoch === epoch && laterController === requestController) {
				state.loadingLater = false;
				laterController = null;
			}
		}
	}
	/**
	 * 切换排序：清空已加载的分页，从对应的一端重新读取第一页。
	 *
	 * 两端的分页方向相反（更早 vs 更新），混用旧页会让加载按钮指向错误的端点。
	 * @param value - true 为最新优先，false 为最早优先
	 */
	async function setNewestFirst(value: boolean) {
		if (state.newestFirst === value) return;
		state.newestFirst = value;
		version++;
		controller?.abort();
		earlierController?.abort();
		laterController?.abort();
		controller = null;
		earlierController = null;
		laterController = null;
		inFlight = null;
		earlierCursor = null;
		laterCursor = null;
		state.response = undefined;
		state.earlier = [];
		state.later = [];
		state.earlierHasMore = false;
		state.earlierLoaded = false;
		state.laterHasMore = false;
		state.laterLoaded = false;
		state.loadingEarlier = false;
		state.loadingLater = false;
		state.earlierError = null;
		state.laterError = null;
		state.error = null;
		state.loading = true;
		await refresh();
	}
	function connect() {
		if (!enabled || !group) return;
		const selectedEpoch = epoch,
			selectedGroup = group;
		try {
			stopSocket = socketFactory(selectedGroup, teamId, {
				open: () => {
					if (selectedEpoch !== epoch || !enabled) return;
					reconnectAttempt = 0;
					serverTimedOut = false;
					state.streaming = true;
				},
				frame: (frame) => {
					if (selectedEpoch !== epoch || !enabled || !state.newestFirst) return;
					const target = frame.group;
					if (!target || typeof target !== "object" || Array.isArray(target)) return;
					const record = target as Record<string, unknown>;
					if (record.type !== selectedGroup.type || record.id !== selectedGroup.id) return;
					try {
						if (frame.type === "snapshot") {
							state.response = parseSessionTimeline(frame.data);
							version++;
							state.loading = false;
							state.error = null;
						} else if (frame.type === "update") {
							state.response = applySessionTimelineUpdate(state.response, parseSessionTimelineUpdate(frame.data));
							version++;
							state.loading = false;
							state.error = null;
						} else if (frame.type === "timeout") serverTimedOut = true;
					} catch {
						/* Keep the last valid timeline when a frame is malformed. */
					}
				},
				close: () => {
					if (selectedEpoch !== epoch || !enabled) return;
					state.streaming = false;
					const stop = stopSocket;
					stopSocket = null;
					stop?.();
					const delay = serverTimedOut ? 250 : Math.min(30000, 1000 * 2 ** reconnectAttempt++);
					if (serverTimedOut) reconnectAttempt = 0;
					serverTimedOut = false;
					retryTimer = setTimeout(() => {
						retryTimer = null;
						connect();
					}, delay);
				},
			});
		} catch {
			state.streaming = false;
		}
	}
	function bind(nextGroup: SessionGroupRef | null, nextTeamId: string | undefined, open = true) {
		if (open && enabled && group?.type === nextGroup?.type && group?.id === nextGroup?.id && teamId === nextTeamId) return;
		close();
		if (!open || !nextGroup) return;
		group = nextGroup;
		teamId = nextTeamId;
		enabled = true;
		connect();
		void refresh();
	}
	function close() {
		enabled = false;
		epoch++;
		version = 0;
		if (retryTimer !== null) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		const stop = stopSocket;
		stopSocket = null;
		stop?.();
		controller?.abort();
		earlierController?.abort();
		laterController?.abort();
		controller = null;
		earlierController = null;
		laterController = null;
		inFlight = null;
		group = null;
		reconnectAttempt = 0;
		serverTimedOut = false;
		earlierCursor = null;
		laterCursor = null;
		state.earlierHasMore = false;
		state.earlierLoaded = false;
		state.laterHasMore = false;
		state.laterLoaded = false;
		Object.assign(state, {
			response: undefined,
			earlier: [],
			later: [],
			loading: false,
			refreshing: false,
			streaming: false,
			error: null,
			loadingEarlier: false,
			loadingLater: false,
			earlierError: null,
			laterError: null,
		});
	}
	return {
		state,
		combined,
		displayed,
		canLoadEarlier,
		canLoadLater,
		bind,
		refresh,
		loadEarlier,
		loadLater,
		setNewestFirst,
		close,
		dispose: close,
	};
}
export type SessionTimelineStore = ReturnType<typeof createSessionTimelineStore>;
