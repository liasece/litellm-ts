import type { ActiveUserPoint, PerUserMetric } from "../api/UserAgentUsageApi";
export function extractUserAgent(tag: string): string {
	return tag.startsWith("User-Agent: ") ? tag.replace("User-Agent: ", "") : tag;
}
export function abbreviated(value: number, places = 0): string {
	return value >= 1e6
		? (value / 1e6).toFixed(places) + "M"
		: value >= 1000
			? (value / 1000).toFixed(places) + "K"
			: value.toFixed(places);
}
export function activeUserChart(points: ActiveUserPoint[], period: "dau" | "wau" | "mau", today = new Date()) {
	const totals = new Map<string, number>();
	for (const point of points) totals.set(point.tag, (totals.get(point.tag) ?? 0) + point.active_users);
	const tags = [...totals]
		.sort(([, a], [, b]) => b - a)
		.slice(0, 10)
		.map(([tag]) => tag);
	const categories = tags.map(extractUserAgent),
		index = period === "dau" ? "date" : period === "wau" ? "week" : "month";
	const data: Array<Record<string, string | number>> = Array.from({ length: 7 }, (_, i) => {
		const date = new Date(today);
		date.setDate(date.getDate() - (6 - i));
		return Object.fromEntries([
			[index, period === "dau" ? date.toISOString().split("T")[0] : (period === "wau" ? "Week " : "Month ") + (i + 1)],
			...categories.map((name) => [name, 0]),
		]);
	});
	for (const point of points) {
		const match = point.date.match(period === "wau" ? /Week (\d+)/ : /Month (\d+)/);
		const key = period === "dau" ? point.date : match ? (period === "wau" ? "Week " : "Month ") + match[1] : null;
		const row = data.find((row) => row[index] === key);
		if (row) row[extractUserAgent(point.tag)] = point.active_users;
	}
	return { data, categories, index };
}
export function usageDistribution(users: PerUserMetric[]) {
	const counts = new Map<string, number>();
	for (const user of users) {
		const name = user.user_agent || "Unknown";
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const categories = [...counts]
		.sort(([, a], [, b]) => b - a)
		.slice(0, 8)
		.map(([name]) => name);
	const ranges = [
		["1-9 requests", 1, 9],
		["10-99 requests", 10, 99],
		["100-999 requests", 100, 999],
		["1K-9.9K requests", 1000, 9999],
		["10K-99.9K requests", 10000, 99999],
		["100K+ requests", 100000, Infinity],
	] as const;
	const data: Array<Record<string, string | number>> = ranges.map(([category, min, max]) => ({
		category,
		...Object.fromEntries(
			categories.map((agent) => [
				agent,
				users.filter((u) => (u.user_agent || "Unknown") === agent && u.successful_requests >= min && u.successful_requests <= max)
					.length,
			]),
		),
	}));
	return { data, categories };
}
