import { shallowReactive } from "vue";
import type { NotificationConfig, NotificationEntry, NotificationKind } from "../support/NotificationModels";
interface NotificationStoreOptions {
	now?: () => number;
}
export function createNotificationStore(options: NotificationStoreOptions = {}) {
	const notices = shallowReactive<NotificationEntry[]>([]);
	const now = options.now ?? (() => performance.now());
	let nextId = 0;
	const timers = new Map<
		number,
		{ close: ReturnType<typeof setTimeout>; tick: ReturnType<typeof setInterval>; started: number; remaining: number }
	>();
	function cancelTimers(id: number) {
		const timer = timers.get(id);
		if (!timer) return;
		clearTimeout(timer.close);
		clearInterval(timer.tick);
		timers.delete(id);
	}
	function close(id: number) {
		cancelTimers(id);
		const index = notices.findIndex((notice) => notice.id === id);
		if (index >= 0) notices.splice(index, 1);
	}
	function start(notice: NotificationEntry) {
		cancelTimers(notice.id);
		if (notice.duration <= 0 || notice.paused) return;
		const started = now(),
			remaining = notice.remaining;
		const tick = setInterval(() => {
			notice.remaining = Math.max(0, remaining - (now() - started));
		}, 50);
		const timer = setTimeout(() => close(notice.id), remaining);
		timers.set(notice.id, { close: timer, tick, started, remaining });
	}
	function push(type: NotificationKind, config: NotificationConfig & { message: NotificationEntry["message"]; duration: number }) {
		const existing = config.key ? notices.find((notice) => notice.key === config.key) : undefined;
		const fields = {
			type,
			message: config.message,
			description: config.description,
			duration: config.duration,
			remaining: Math.max(0, config.duration * 1000),
			placement: config.placement ?? ("topRight" as const),
			paused: false,
			key: config.key,
		};
		if (existing) {
			cancelTimers(existing.id);
			Object.assign(existing, fields);
			start(existing);
			return existing.id;
		}
		const notice = shallowReactive<NotificationEntry>({ id: ++nextId, ...fields });
		notices.unshift(notice);
		start(notice);
		return notice.id;
	}
	function pause(id: number) {
		const notice = notices.find((notice) => notice.id === id);
		if (!notice || notice.paused) return;
		const timer = timers.get(id);
		if (timer) notice.remaining = Math.max(0, timer.remaining - (now() - timer.started));
		cancelTimers(id);
		notice.paused = true;
	}
	function resume(id: number) {
		const notice = notices.find((notice) => notice.id === id);
		if (!notice || !notice.paused) return;
		notice.paused = false;
		start(notice);
	}
	function clear() {
		for (const id of timers.keys()) cancelTimers(id);
		notices.splice(0);
	}
	return { notices, push, close, pause, resume, clear };
}
export const notificationStore = createNotificationStore();
