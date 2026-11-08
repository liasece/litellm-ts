export interface McpToolEntry {
	name: string;
	description?: string;
}
export function suggestedMcpTools(tools: McpToolEntry[], keyTools: McpToolEntry[]) {
	const used = new Set<string>(),
		result: McpToolEntry[] = [];
	for (const keyTool of keyTools) {
		const keywords = keyTool.name
			.split("_")
			.map((word) => word.toLowerCase())
			.filter((word) => word.length > 1);
		if (!keywords.length) continue;
		const normalize = (word: string) => word.toLowerCase().replace(/[-_/]/g, " ");
		let match = tools.find((tool) => !used.has(tool.name) && keywords.every((word) => normalize(tool.name).includes(word)));
		if (!match) {
			const main = keywords.find((word) => word.length > 3) ?? keywords[keywords.length - 1];
			match = tools.find((tool) => !used.has(tool.name) && normalize(tool.name).includes(main));
		}
		if (match) {
			result.push(match);
			used.add(match.name);
		}
	}
	return result;
}
