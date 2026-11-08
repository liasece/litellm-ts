import type { PlaygroundMcpServer } from "../support/PlaygroundModels";
import { asRecord, records } from "./PlaygroundValueLogic";
import type { AgentModel } from "../api/PlaygroundAgentBuilderApi";
const prefix = "litellm_proxy/mcp/";
export function agentServerIds(tools: unknown, servers: PlaygroundMcpServer[]) {
	return records(tools)
		.filter((tool) => tool.type === "mcp" && typeof tool.server_url === "string" && tool.server_url.startsWith(prefix))
		.flatMap((tool) => {
			const server = servers.find(
				(server) => (server.alias || server.server_name || server.server_id) === String(tool.server_url).slice(prefix.length),
			);
			return server ? [server.server_id] : [];
		});
}
export function agentTools(ids: string[], servers: PlaygroundMcpServer[]) {
	return ids.map((id) => {
		const server = servers.find((server) => server.server_id === id);
		return {
			type: "mcp",
			server_label: "litellm",
			server_url: prefix + (server?.alias || server?.server_name || id),
			require_approval: "never",
		};
	});
}
export function agentModelId(agent: AgentModel | null) {
	const id = asRecord(agent?.model_info)?.id;
	return typeof id === "string" ? id : null;
}
export function agentConnectBase(settings: Record<string, unknown>, apiBase: string, customBase = "") {
	if (apiBase) return apiBase;
	const doc = settings.LITELLM_UI_API_DOC_BASE_URL;
	if (typeof doc === "string" && doc.trim()) return doc;
	const proxy = settings.PROXY_BASE_URL;
	if (typeof proxy === "string" && proxy) return proxy;
	if (customBase.trim()) return customBase;
	return "<your_proxy_base_url>";
}
export function agentCurl(base: string, name: string, key: string | null) {
	const bearer = key ? (key.startsWith("Bearer ") ? key : "Bearer " + key) : "Bearer sk-1234";
	return (
		"curl -L -X POST '" +
		base +
		"/v1/chat/completions' \\\n-H 'x-litellm-api-key: " +
		bearer +
		"' \\\n-d '" +
		JSON.stringify(
			{ model: name, stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "hey" }] },
			null,
			2,
		) +
		"'"
	);
}
