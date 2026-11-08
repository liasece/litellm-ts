import type { HubLink, UsefulLinks } from "../support/ModelHubModels";
export function parseHubLinks(links: UsefulLinks): HubLink[] {
	return Object.entries(links)
		.map(([displayName, value]) => ({
			id: "",
			displayName,
			url: typeof value === "string" ? value : value.url,
			index: typeof value === "string" ? 0 : (value.index ?? 0),
		}))
		.sort((a, b) => a.index - b.index)
		.map((link, index) => ({ ...link, id: index + "-" + link.displayName }));
}
export function serializeHubLinks(links: HubLink[]): UsefulLinks {
	return Object.fromEntries(links.map((link, index) => [link.displayName, { url: link.url, index }]));
}
export function validateHubLink(candidate: Pick<HubLink, "displayName" | "url">, links: HubLink[], exclude?: string): string | null {
	try {
		new URL(candidate.url);
	} catch {
		return "Please enter a valid URL";
	}
	if (links.some((link) => link.id !== exclude && link.displayName === candidate.displayName))
		return "A link with this display name already exists";
	return null;
}
export function moveHubLink(links: HubLink[], index: number, offset: number) {
	const target = index + offset;
	if (index < 0 || target < 0 || index >= links.length || target >= links.length) return links;
	const next = [...links];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}
