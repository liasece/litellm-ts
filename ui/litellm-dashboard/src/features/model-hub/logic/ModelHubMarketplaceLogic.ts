import type { HubPlugin } from "../support/ModelHubModels";
export function installCommand(plugin: HubPlugin) {
	return (
		"/plugin marketplace add " +
		(plugin.source.source === "github" && plugin.source.repo
			? plugin.source.repo
			: plugin.source.source === "url" && plugin.source.url
				? plugin.source.url
				: plugin.name)
	);
}
export function marketplaceCategories(plugins: HubPlugin[]) {
	return [
		"All",
		...[
			...new Set(plugins.map((plugin) => plugin.category).filter((category): category is string => Boolean(category?.trim()))),
		].sort(),
		"Other",
	];
}
export function filterMarketplace(plugins: HubPlugin[], search: string, category: string) {
	const term = search.toLowerCase().trim();
	return plugins.filter(
		(plugin) =>
			(category === "All" || (category === "Other" ? !plugin.category?.trim() : plugin.category === category)) &&
			(!term ||
				plugin.name.toLowerCase().includes(term) ||
				plugin.description?.toLowerCase().includes(term) ||
				plugin.keywords?.some((keyword) => keyword.toLowerCase().includes(term))),
	);
}
export function sourceDisplay(plugin: HubPlugin) {
	return plugin.source.source === "github" && plugin.source.repo
		? "GitHub: " + plugin.source.repo
		: plugin.source.source === "url" && plugin.source.url
			? plugin.source.url
			: "Unknown source";
}
export function categoryColor(category?: string) {
	const value = category?.toLowerCase() ?? "";
	if (value.includes("development") || value.includes("dev")) return "blue";
	if (value.includes("productivity") || value.includes("workflow")) return "green";
	if (value.includes("learning") || value.includes("education")) return "purple";
	if (value.includes("security") || value.includes("safety")) return "red";
	if (value.includes("data") || value.includes("analytics")) return "orange";
	if (value.includes("integration") || value.includes("api")) return "yellow";
	return "gray";
}
