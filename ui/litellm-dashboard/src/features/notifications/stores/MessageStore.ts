import { reactive } from "vue";
import type { MessageClose, MessageEntry, MessageKind } from "../support/MessageModels";
export function createMessageStore() {
	const entries = reactive<MessageEntry[]>([]),
		timers = new Map<number, ReturnType<typeof setTimeout>>(),
		resolvers = new Map<number, (value: boolean) => void>();
	let sequence = 0;
	function close(id: number) {
		const timer = timers.get(id);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(id);
		const index = entries.findIndex((entry) => entry.id === id);
		if (index >= 0) entries.splice(index, 1);
		resolvers.get(id)?.(true);
		resolvers.delete(id);
	}
	function push(type: MessageKind, content: string, duration = 3): MessageClose {
		const id = ++sequence,
			promise = new Promise<boolean>((resolve) => resolvers.set(id, resolve));
		entries.push({ id, type, content, duration });
		if (duration > 0)
			timers.set(
				id,
				setTimeout(() => close(id), duration * 1000),
			);
		return Object.assign(() => close(id), { then: promise.then.bind(promise) });
	}
	function clear() {
		for (const entry of [...entries]) close(entry.id);
	}
	return { entries, push, close, clear };
}
export const messageStore = createMessageStore();
