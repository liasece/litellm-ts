import type { ChatConversation } from "../support/ChatModels";
export function chatTitle(text: string) {
	const value = text.trim();
	return value.length <= 40 ? value : value.slice(0, 40) + "…";
}
export function trimChatHistory(items: ChatConversation[]) {
	return items.length <= 100 ? items : [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
}
export function chatDateGroup(timestamp: number, now = new Date()) {
	const date = new Date(timestamp),
		today = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
		yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	if (date >= today) return "Today";
	if (date >= yesterday && date < today) return "Yesterday";
	const week = new Date(now);
	week.setDate(week.getDate() - 7);
	return date > week ? "Last 7 Days" : "Older";
}
export function groupedChatHistory(items: ChatConversation[], now = new Date()) {
	const order = ["Today", "Yesterday", "Last 7 Days", "Older"];
	return order.flatMap((group) => {
		const matches = items.filter((item) => chatDateGroup(item.updatedAt, now) === group);
		return matches.length ? [{ group, items: matches }] : [];
	});
}
export function chatGreeting(now = new Date()) {
	const hour = now.getHours();
	return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : "Good evening";
}
export function redactChatToolArguments(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactChatToolArguments);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				/token|key|secret|password|auth/i.test(key) ? "[redacted]" : redactChatToolArguments(item),
			]),
		);
	return value;
}
export function chatTimestamp(timestamp: number) {
	const date = new Date(timestamp);
	return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}
