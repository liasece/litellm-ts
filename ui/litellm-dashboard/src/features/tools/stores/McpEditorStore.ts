import { ref, watch } from "vue";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { mcpApi } from "../api/McpServersApi";
import { mcpDiscoveryDraft, mcpEditDraft, mcpFormErrors, mcpPayload, objectValue, staticHeaders } from "../logic/McpDraftLogic";
import { createMcpOAuthFlowStore } from "./McpOAuthFlowStore";
import { createMcpConnectionStore } from "./McpConnectionStore";
import type { MCPServer, DiscoverableMCPServer, McpFormConfig, OpenAPIEntry } from "../support/McpModels";
export const MCP_CREATE_STATE = "litellm-mcp-oauth-create-state",
	MCP_EDIT_STATE = "litellm-mcp-oauth-edit-state";
export function createMcpEditorStore(existing?: MCPServer, admin = true) {
	const draft = ref<Record<string, unknown>>(
			existing ? mcpEditDraft(existing) : { allow_all_keys: false, available_on_public_internet: true, credentials: {} },
		),
		config = ref<McpFormConfig>({
			cost: existing?.mcp_info?.mcp_server_cost_info || {},
			allowedTools: existing?.allowed_tools || [],
			displayNames: existing?.tool_name_to_display_name || {},
			descriptions: existing?.tool_name_to_description || {},
			logo: existing?.mcp_info?.logo_url || undefined,
		}),
		pending = ref(false),
		error = ref(""),
		message = ref(""),
		errors = ref<Record<string, string>>({}),
		aliasEdited = ref(false),
		suggestions = ref<{ name: string; description: string }[]>([]),
		docsUrl = ref<string | null>(null);
	const connection = createMcpConnectionStore(() => draft.value);
	function persist() {
		try {
			window.sessionStorage.setItem(
				existing ? MCP_EDIT_STATE : MCP_CREATE_STATE,
				JSON.stringify({
					...(existing ? { serverId: existing.server_id } : { modalVisible: true }),
					formValues: draft.value,
					transportType: draft.value.transport,
					costConfig: config.value.cost,
					allowedTools: config.value.allowedTools,
					searchValue: "",
					aliasManuallyEdited: aliasEdited.value,
					logoUrl: config.value.logo,
				}),
			);
		} catch {
			error.value = "Unable to access browser storage for OAuth. Please enable storage and retry.";
		}
	}
	const oauth = createMcpOAuthFlowStore(
		() => {
			const value = draft.value,
				transport = value.transport || existing?.transport,
				url = existing ? value.url || existing.url : value.url || (transport === "openapi" ? value.spec_path : undefined);
			if (!url || !transport) return null;
			return {
				server_id: existing?.server_id,
				server_name: value.server_name || existing?.server_name || existing?.alias,
				alias: value.alias || existing?.alias,
				description: value.description || existing?.description,
				url,
				transport: !existing && transport === "openapi" ? "http" : transport,
				auth_type: "oauth2",
				credentials: value.credentials,
				authorization_url: value.authorization_url,
				token_url: value.token_url,
				registration_url: value.registration_url,
				mcp_access_groups: value.mcp_access_groups || existing?.mcp_access_groups,
				static_headers: staticHeaders(value.static_headers),
				command: value.command,
				args: value.args,
				env: value.env,
			};
		},
		(token) => {
			connection.token.value = typeof token.access_token === "string" ? token.access_token : null;
			if (token.access_token)
				draft.value.credentials = {
					access_token: token.access_token,
					...(token.refresh_token ? { refresh_token: token.refresh_token } : {}),
					...(token.expires_in ? { expires_in: token.expires_in } : {}),
					...(token.scope ? { scope: token.scope } : {}),
				};
			message.value = existing
				? "OAuth authorization successful! Please click 'Update MCP Server' to save the credentials."
				: "OAuth authorization successful! Please click 'Create MCP Server' to save the configuration.";
			notificationManager.success(message.value);
		},
		persist,
	);
	const stop = watch(
		() => draft.value.server_name,
		(value) => {
			if (!aliasEdited.value && value) draft.value.alias = String(value).replace(/\s+/g, "_");
		},
	);
	function transportChanged(value: unknown) {
		if (value === "stdio") {
			for (const field of [
				"url",
				"spec_path",
				"auth_type",
				"credentials",
				...(existing ? ["authorization_url", "token_url", "registration_url"] : []),
			])
				draft.value[field] = undefined;
		} else {
			for (const field of [
				value === "openapi" ? "url" : "spec_path",
				"command",
				"args",
				existing ? "env_json" : "env",
				...(existing ? ["stdio_config"] : []),
			])
				draft.value[field] = undefined;
		}
	}
	function prefill(server: DiscoverableMCPServer) {
		draft.value = mcpDiscoveryDraft(server);
		aliasEdited.value = false;
	}
	function preset(entry: OpenAPIEntry) {
		suggestions.value = entry.key_tools || [];
		config.value.logo = entry.icon_url || undefined;
		draft.value.spec_path = entry.spec_url;
		if (entry.oauth) {
			Object.assign(draft.value, {
				auth_type: "oauth2",
				oauth_flow_type: "interactive",
				authorization_url: entry.oauth.authorization_url,
				token_url: entry.oauth.token_url,
			});
			docsUrl.value = entry.oauth.docs_url || null;
		} else {
			for (const field of ["auth_type", "authorization_url", "token_url"]) draft.value[field] = undefined;
			docsUrl.value = null;
		}
	}
	function restore() {
		try {
			const key = existing ? MCP_EDIT_STATE : MCP_CREATE_STATE,
				raw = window.sessionStorage.getItem(key);
			if (!raw) return;
			const parsed = objectValue(JSON.parse(raw));
			if (existing && parsed.serverId !== existing.server_id) return;
			const values = objectValue(parsed.formValues);
			draft.value = { ...(existing ? mcpEditDraft(existing) : {}), ...values };
			if (parsed.costConfig) config.value.cost = objectValue(parsed.costConfig);
			if (Array.isArray(parsed.allowedTools))
				config.value.allowedTools = parsed.allowedTools.filter((value): value is string => typeof value === "string");
			if (typeof parsed.aliasManuallyEdited === "boolean") aliasEdited.value = parsed.aliasManuallyEdited;
			if (typeof parsed.logoUrl === "string") config.value.logo = parsed.logoUrl;
			window.sessionStorage.removeItem(key);
		} catch {
			error.value = "Failed to restore MCP form state";
		}
	}
	async function save() {
		errors.value = mcpFormErrors(draft.value, Boolean(existing));
		if (Object.keys(errors.value).length) return null;
		pending.value = true;
		error.value = "";
		try {
			const payload = mcpPayload(draft.value, config.value, existing);
			const result = existing ? await mcpApi.update(payload) : await mcpApi.create(payload, admin);
			message.value = existing
				? "MCP Server updated successfully"
				: admin
					? "MCP Server created successfully"
					: "MCP Server submitted for admin review";
			notificationManager.success(message.value);
			return result;
		} catch (reason) {
			error.value =
				(existing ? "Failed to update MCP Server" : admin ? "Error creating MCP Server" : "Error submitting MCP Server") +
				": " +
				(reason instanceof Error ? reason.message : String(reason));
			notificationManager.fromBackend(error.value);
			return null;
		} finally {
			pending.value = false;
		}
	}
	return {
		draft,
		config,
		pending,
		error,
		message,
		errors,
		aliasEdited,
		suggestions,
		docsUrl,
		connection,
		oauth,
		setDraft(value: Record<string, unknown>) {
			draft.value = value;
		},
		setLogo(value: string | undefined) {
			config.value.logo = value;
		},
		markAliasEdited() {
			aliasEdited.value = true;
		},
		clearPreset() {
			suggestions.value = [];
			docsUrl.value = null;
		},
		prefill,
		preset,
		restore,
		transportChanged,
		save,
		dispose() {
			stop();
			connection.dispose();
		},
	};
}
