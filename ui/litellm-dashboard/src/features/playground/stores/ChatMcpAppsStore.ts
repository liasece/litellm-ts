import { computed, shallowReactive } from "vue";
import type { PlaygroundMcpServer, PlaygroundMcpTool } from "../support/PlaygroundModels";
import { playgroundCatalogApi } from "../api/PlaygroundCatalogApi";
import { chatMcpCredentialsApi } from "../api/ChatMcpCredentialsApi";
import { createChatMcpOAuthStore } from "./ChatMcpOAuthStore";
import { chatMcpName } from "../logic/ChatMcpLogic";
import { messageManager } from "../../notifications/logic/MessageManager";
export function createChatMcpAppsStore(options: { selected: () => string[]; change: (names: string[]) => void }) {
	const state = shallowReactive({
			servers: [] as PlaygroundMcpServer[],
			loading: true,
			query: "",
			tab: "all" as "all" | "connected",
			toggling: new Set<string>(),
			detail: null as PlaygroundMcpServer | null,
			tools: [] as PlaygroundMcpTool[],
			loadingTools: false,
			counts: {} as Record<string, number>,
			loadingCounts: false,
			oauthConnected: new Set<string>(),
		}),
		filtered = computed(() =>
			state.servers.filter(
				(server) =>
					(!state.query.trim() ||
						(chatMcpName(server) + " " + String(server.description ?? "")).toLowerCase().includes(state.query.toLowerCase())) &&
					(state.tab === "all" || options.selected().includes(chatMcpName(server))),
			),
		);
	let controller: AbortController | undefined,
		generation = 0,
		detailGeneration = 0;
	function connected(id: string) {
		const next = new Set(state.oauthConnected);
		next.add(id);
		state.oauthConnected = next;
		const server = state.servers.find((server) => server.server_id === id);
		if (server && !options.selected().includes(chatMcpName(server))) options.change([...options.selected(), chatMcpName(server)]);
	}
	const oauth = createChatMcpOAuthStore({ connected });
	async function load(apps = true) {
		controller?.abort();
		controller = new AbortController();
		const current = ++generation,
			signal = controller.signal;
		state.loading = true;
		try {
			const servers = await playgroundCatalogApi.servers(signal);
			if (current !== generation) return;
			state.servers = servers;
			state.loading = false;
			if (!apps) return;
			state.loadingCounts = Boolean(servers.length);
			let remaining = servers.length;
			await Promise.allSettled(
				servers.map(async (server) => {
					const name = chatMcpName(server);
					const result = await playgroundCatalogApi.tools(server.server_id, undefined, signal);
					if (current !== generation) return;
					state.counts = { ...state.counts, [name]: result.tools.length };
					remaining--;
					if (!remaining) state.loadingCounts = false;
				}),
			);
			if (current !== generation) return;
			await Promise.allSettled(
				servers
					.filter((server) => server.auth_type === "oauth2")
					.map(async (server) => {
						const status = await chatMcpCredentialsApi.status(server.server_id, signal);
						if (current === generation && status.has_credential && !status.is_expired) connected(server.server_id);
					}),
			);
			if (current === generation) await oauth.resume(servers.map((server) => server.server_id));
		} catch {
			if (current === generation) state.servers = [];
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	async function toggle(server: PlaygroundMcpServer, checked: boolean, picker = false) {
		const name = chatMcpName(server);
		if (!checked) {
			options.change(options.selected().filter((value) => value !== name));
			const next = new Set(state.oauthConnected);
			next.delete(server.server_id);
			state.oauthConnected = next;
			return;
		}
		const current = generation;
		state.toggling = new Set([...state.toggling, name]);
		try {
			const result = await playgroundCatalogApi.tools(picker ? name : server.server_id, undefined, controller?.signal);
			if (current !== generation) return;
			if (result.error) {
				messageManager.warning("Could not load tools for " + name + (picker ? " — it will be excluded from this message." : ""));
				return;
			}
			if (!options.selected().includes(name)) options.change([...options.selected(), name]);
		} catch {
			if (current === generation)
				messageManager.warning("Could not load tools for " + name + (picker ? " — it will be excluded from this message." : ""));
		} finally {
			if (current === generation) {
				const next = new Set(state.toggling);
				next.delete(name);
				state.toggling = next;
			}
		}
	}
	async function detail(server: PlaygroundMcpServer | null) {
		state.detail = server;
		const current = ++detailGeneration;
		state.tools = [];
		if (!server) return;
		state.loadingTools = true;
		try {
			const result = await playgroundCatalogApi.tools(server.server_id, undefined, controller?.signal);
			if (current === detailGeneration) state.tools = result.tools;
		} finally {
			if (current === detailGeneration) state.loadingTools = false;
		}
	}
	async function disconnect(server: PlaygroundMcpServer) {
		try {
			await chatMcpCredentialsApi.remove(server.server_id);
		} catch {
			/* Remove stale local connection state even when the credential is already gone. */
		}
		await toggle(server, false);
	}
	function dispose() {
		generation++;
		detailGeneration++;
		controller?.abort();
		oauth.dispose();
	}
	return { state, filtered, oauth, load, toggle, detail, disconnect, dispose };
}
export type ChatMcpAppsStore = ReturnType<typeof createChatMcpAppsStore>;
