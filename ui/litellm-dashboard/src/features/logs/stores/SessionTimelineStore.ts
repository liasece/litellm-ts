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
		loading: false,
		refreshing: false,
		streaming: false,
		error: null as string | null,
		loadingEarlier: false,
		earlierError: null as string | null,
		newestFirst: true,
		earlierHasMore: false,
		earlierLoaded: false,
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
		earlierCursor: string | null = null;
	let controller: AbortController | null = null,
		earlierController: AbortController | null = null,
		inFlight: Promise<void> | null = null;
	const combined = computed(() => {
		const values = [
			...state.earlier,
			...(state.response?.data ?? []),
			...(state.response?.active_requests ?? []).flatMap((request) => request.events),
		];
		const byId = new Map(values.map((event) => [event.id, event]));
		return [...byId.values()];
	});
	const displayed = computed(() => (state.newestFirst ? [...combined.value].reverse() : combined.value));
	const canLoadEarlier = computed(() => state.earlierHasMore || (!state.earlierLoaded && Boolean(state.response?.window?.has_more)));
	async function refresh() {
		if (!enabled || !group) return;
		if (inFlight) return inFlight;
		const selectedEpoch = epoch,
			selectedVersion = version,
			selectedGroup = group,
			requestController = new AbortController();
		controller = requestController;
		state.loading = state.response === undefined;
		state.refreshing = true;
		state.error = null;
		const request = (async () => {
			try {
				const response = await api.fetch(selectedGroup, teamId, { signal: requestController.signal });
				if (selectedEpoch === epoch && enabled && !requestController.signal.aborted && selectedVersion === version)
					state.response = response;
			} catch (error) {
				if (selectedEpoch === epoch && !requestController.signal.aborted)
					state.error = safeSessionError(error, "Session 历史加载失败");
			} finally {
				if (selectedEpoch === epoch) {
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
		if (!enabled || !group || !cursor || state.loadingEarlier) return;
		const selectedEpoch = epoch,
			requestController = new AbortController();
		earlierController = requestController;
		state.loadingEarlier = true;
		state.earlierError = null;
		try {
			const page = await api.fetch(group, teamId, { before: cursor, signal: requestController.signal });
			if (selectedEpoch !== epoch || requestController.signal.aborted) return;
			state.earlier = [...page.data, ...state.earlier];
			earlierCursor = page.window?.before ?? null;
			state.earlierHasMore = page.window?.has_more ?? false;
			state.earlierLoaded = true;
		} catch (error) {
			if (selectedEpoch === epoch && !requestController.signal.aborted)
				state.earlierError = safeSessionError(error, "加载更早的请求失败", 200);
		} finally {
			if (selectedEpoch === epoch) {
				state.loadingEarlier = false;
				earlierController = null;
			}
		}
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
					if (selectedEpoch !== epoch || !enabled) return;
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
		controller = null;
		earlierController = null;
		inFlight = null;
		group = null;
		reconnectAttempt = 0;
		serverTimedOut = false;
		earlierCursor = null;
		state.earlierHasMore = false;
		state.earlierLoaded = false;
		Object.assign(state, {
			response: undefined,
			earlier: [],
			loading: false,
			refreshing: false,
			streaming: false,
			error: null,
			loadingEarlier: false,
			earlierError: null,
		});
	}
	return { state, combined, displayed, canLoadEarlier, bind, refresh, loadEarlier, close, dispose: close };
}
export type SessionTimelineStore = ReturnType<typeof createSessionTimelineStore>;
