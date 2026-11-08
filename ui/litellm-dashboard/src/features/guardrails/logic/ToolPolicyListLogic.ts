import type { ToolPolicyRow, ToolPolicySortField } from "../support/ToolPolicyModels";
export function utcToolDateKey(date: Date) {
	return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
}
function inDay(tool: ToolPolicyRow, key: string) {
	return Boolean(tool.created_at && utcToolDateKey(new Date(tool.created_at)) === key);
}
export function toolPolicyMetrics(tools: ToolPolicyRow[], now = new Date()) {
	const today = utcToolDateKey(now),
		yesterday = new Date(now);
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);
	const newToday = tools.filter((tool) => inDay(tool, today)).length,
		newYesterday = tools.filter((tool) => inDay(tool, utcToolDateKey(yesterday))).length,
		diff = newToday - newYesterday;
	return {
		newToday,
		newYesterday,
		trendSubtitle: diff ? (diff > 0 ? "+" + diff + " since yesterday" : diff + " since yesterday") : undefined,
		totalTools: tools.length,
		blockedCount: tools.filter((tool) => tool.input_policy === "blocked").length,
		activeTeamsCount: new Set(tools.map((tool) => tool.team_id).filter(Boolean)).size,
		needsReviewTools: tools.filter((tool) => inDay(tool, today) && tool.input_policy === "untrusted"),
	};
}
export function filterToolPolicies(tools: ToolPolicyRow[], search: string, filters: Record<string, string>) {
	const query = search.toLowerCase();
	return tools.filter((tool) => {
		if (
			query &&
			![tool.tool_name, tool.team_id ?? "", tool.key_alias ?? "", tool.key_hash ?? "", tool.input_policy, tool.output_policy].some(
				(value) => value.toLowerCase().includes(query),
			)
		)
			return false;
		for (const [name, field] of [
			["Input Policy", "input_policy"],
			["Output Policy", "output_policy"],
			["Team Name", "team_id"],
			["Key Name", "key_alias"],
		] as const)
			if (filters[name] && tool[field] !== filters[name]) return false;
		return true;
	});
}
export function sortToolPolicies(tools: ToolPolicyRow[], field: ToolPolicySortField, order: "asc" | "desc") {
	return [...tools].sort((a, b) => {
		const left = a[field] ?? "",
			right = b[field] ?? "";
		if (left < right) return order === "desc" ? 1 : -1;
		if (left > right) return order === "desc" ? -1 : 1;
		return 0;
	});
}
export function toolDiscoveryTime(value: string) {
	try {
		return new Date(value)
			.toLocaleString("en-US", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false,
			})
			.replace(",", "");
	} catch {
		return "Error converting time";
	}
}
