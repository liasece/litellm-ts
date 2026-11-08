import type { MCPServer } from "../support/McpModels";
function matchesGroup(value: unknown, group: string) {
	return typeof value === "string"
		? value === group
		: Boolean(value && typeof value === "object" && "name" in value && value.name === group);
}
export function filterMcpServers(servers: MCPServer[], teamId: string, group: string) {
	if (teamId === "personal") return [];
	return servers
		.filter(
			(server) =>
				(teamId === "all" || server.teams?.some((team) => team.team_id === teamId)) &&
				(group === "all" || server.mcp_access_groups?.some((value) => matchesGroup(value, group))),
		)
		.sort((a, b) =>
			!a.created_at
				? !b.created_at
					? 0
					: 1
				: !b.created_at
					? -1
					: new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
		);
}
