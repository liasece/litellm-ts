import { z } from "zod";
import type { MCPServer, McpFormConfig, DiscoverableMCPServer } from "../support/McpModels";
export function objectValue(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function staticHeaders(value: unknown): Record<string, string> {
	if (!Array.isArray(value))
		return Object.fromEntries(Object.entries(objectValue(value)).map(([key, item]) => [key, item == null ? "" : String(item)]));
	const result: Record<string, string> = {};
	for (const item of value) {
		const entry = objectValue(item),
			key = String(entry.header || "").trim();
		if (key) result[key] = String(entry.value ?? "");
	}
	return result;
}
export function normalizedCredentials(value: unknown) {
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(objectValue(value))) {
		if (item === undefined || item === null || item === "") continue;
		if (key === "scopes") {
			if (Array.isArray(item)) {
				const filtered = item.filter((scope) => scope != null && scope !== "");
				if (filtered.length) result[key] = filtered;
			}
		} else result[key] = item;
	}
	return result;
}
function stdioConfig(raw: unknown) {
	const parsed = objectValue(JSON.parse(String(raw))),
		servers = objectValue(parsed.mcpServers),
		first = Object.keys(servers)[0];
	return { config: first ? objectValue(servers[first]) : parsed, name: first };
}
function normalizedEnv(value: unknown) {
	return Object.fromEntries(
		Object.entries(objectValue(value))
			.filter(([key]) => key.trim() !== "")
			.map(([key, item]) => [key, item == null ? "" : String(item)]),
	);
}
export function mcpPayload(values: Record<string, unknown>, config: McpFormConfig, existing?: MCPServer): Record<string, unknown> {
	const {
		static_headers: headers,
		credentials,
		stdio_config: rawStdio,
		env_json: envJson,
		command,
		args,
		allow_all_keys: allowAll,
		available_on_public_internet: publicAccess,
		...rest
	} = values;
	let stdio: Record<string, unknown> = {};
	if (values.transport === "stdio") {
		if (rawStdio) {
			let parsed: ReturnType<typeof stdioConfig>;
			try {
				parsed = stdioConfig(rawStdio);
			} catch {
				throw new Error("Invalid JSON in stdio configuration");
			}
			if (existing) {
				stdio = {
					command: parsed.config.command ? String(parsed.config.command) : undefined,
					args: Array.isArray(parsed.config.args) ? parsed.config.args.map(String).filter((item) => item.trim() !== "") : [],
					env: normalizedEnv(parsed.config.env),
				};
				if (!stdio.command) throw new Error("Stdio configuration must include a command");
			} else {
				stdio = { command: parsed.config.command, args: parsed.config.args, env: parsed.config.env };
				if (!rest.server_name && parsed.name) rest.server_name = parsed.name.replace(/-/g, "_");
			}
		} else if (existing) {
			let env: Record<string, string> = {};
			if (envJson)
				try {
					env = normalizedEnv(JSON.parse(String(envJson)));
				} catch {
					throw new Error("Invalid JSON in stdio env configuration");
				}
			const cmd = command ? String(command).trim() : "";
			if (!cmd) throw new Error("Stdio transport requires a command");
			stdio = { command: cmd, args: Array.isArray(args) ? args.map(String).filter((value) => value.trim() !== "") : [], env };
		}
	}
	if (rest.transport === "openapi") rest.transport = "http";
	const result: Record<string, unknown> = {
		...rest,
		...stdio,
		stdio_config: undefined,
		...(existing ? { env_json: undefined, server_id: existing.server_id } : {}),
		mcp_info: {
			server_name: existing
				? rest.server_name || rest.url || existing.server_name || existing.url || rest.alias || existing.alias || "unknown"
				: rest.server_name || rest.url,
			description: rest.description,
			logo_url: config.logo || undefined,
			mcp_server_cost_info: Object.keys(config.cost).length ? config.cost : null,
		},
		mcp_access_groups: existing
			? Array.isArray(rest.mcp_access_groups)
				? rest.mcp_access_groups.map((group) => (typeof group === "string" ? group : objectValue(group).name || String(group)))
				: []
			: rest.mcp_access_groups,
		alias: rest.alias,
		allowed_tools: config.allowedTools.length ? config.allowedTools : null,
		tool_name_to_display_name: Object.keys(config.displayNames).length ? config.displayNames : null,
		tool_name_to_description: Object.keys(config.descriptions).length ? config.descriptions : null,
		allow_all_keys: Boolean(allowAll ?? existing?.allow_all_keys),
		available_on_public_internet: Boolean(publicAccess ?? existing?.available_on_public_internet),
		static_headers: staticHeaders(headers),
	};
	if (existing) {
		result.extra_headers = rest.extra_headers || [];
		result.disallowed_tools = rest.disallowed_tools || [];
	}
	const cleaned = normalizedCredentials(credentials);
	if (
		["api_key", "bearer_token", "token", "basic", "oauth2", "aws_sigv4"].includes(String(rest.auth_type)) &&
		Object.keys(cleaned).length
	)
		result.credentials = cleaned;
	return result;
}
export function mcpEditDraft(server: MCPServer): Record<string, unknown> {
	return {
		...server,
		transport: server.spec_path && server.transport !== "stdio" ? "openapi" : server.transport,
		static_headers: Object.entries(server.static_headers || {}).map(([header, value]) => ({
			header,
			value: value == null ? "" : String(value),
		})),
		oauth_flow_type: server.token_url ? "m2m" : "interactive",
		env_json: server.env && Object.keys(server.env).length ? JSON.stringify(server.env, null, 2) : "",
		mcp_access_groups: server.mcp_access_groups?.map((group) =>
			typeof group === "string" ? group : String(objectValue(group).name || group),
		),
	};
}
export function mcpDiscoveryDraft(server: DiscoverableMCPServer): Record<string, unknown> {
	const name = server.name
		.replace(/[^a-zA-Z0-9_]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
	const result: Record<string, unknown> = {
		server_name: name,
		alias: name,
		description: server.description || "",
		transport: server.transport || "",
		allow_all_keys: false,
		available_on_public_internet: true,
	};
	if (server.transport === "stdio") {
		const config: Record<string, unknown> = {};
		if (server.command) config.command = server.command;
		if (server.args?.length) config.args = server.args;
		if (server.env_vars?.length)
			config.env = Object.fromEntries(
				server.env_vars.map((field) => [field.name, field.description ? "<" + field.description + ">" : ""]),
			);
		if (Object.keys(config).length) result.stdio_config = JSON.stringify(config, null, 2);
	} else if (server.url) result.url = server.url;
	return result;
}
export function mcpFormErrors(values: Record<string, unknown>, editing = false) {
	const errors: Record<string, string> = {},
		transport = values.transport;
	for (const field of ["server_name", "alias"])
		if (typeof values[field] === "string" && (values[field].includes("-") || values[field].includes(" ")))
			errors[field] = "Cannot contain '-' (hyphen) or spaces. Please use '_' (underscore) instead.";
	if (!transport) errors.transport = "Please select a transport type";
	if (transport === "http" || transport === "sse") {
		if (!values.url) errors.url = "Please enter a server URL";
		else if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(String(values.url)))
			errors.url = "Please enter a valid URL (e.g., http://service-name.domain:1234/path or https://example.com)";
	}
	if (transport === "openapi" && !values.spec_path) errors.spec_path = "Please enter an OpenAPI spec URL";
	if (transport === "stdio") {
		if (!editing && !values.stdio_config) errors.stdio_config = "Please enter stdio configuration";
		if (values.stdio_config)
			try {
				JSON.parse(String(values.stdio_config));
			} catch {
				errors.stdio_config = "Please enter valid JSON";
			}
		if (editing && !values.command) errors.command = "Please enter a command for stdio transport";
		if (editing && values.env_json)
			try {
				z.record(z.string(), z.unknown()).parse(JSON.parse(String(values.env_json)));
			} catch {
				errors.env_json = "Env must be a JSON object";
			}
	} else if (transport && !values.auth_type) errors.auth_type = "Please select an auth type";
	const creds = objectValue(values.credentials);
	if (creds.auth_value && typeof creds.auth_value === "string" && !creds.auth_value.trim())
		errors.auth_value = "Authentication value cannot be empty whitespace";
	if (!editing && values.auth_type === "oauth2" && values.oauth_flow_type === "m2m") {
		if (!creds.client_id) errors.client_id = "Client ID is required for M2M OAuth";
		if (!creds.client_secret) errors.client_secret = "Client Secret is required for M2M OAuth";
		if (!values.token_url) errors.token_url = "Token URL is required for M2M OAuth";
	}
	if (!editing && values.auth_type === "aws_sigv4") {
		if (!creds.aws_region_name) errors.aws_region_name = "AWS region is required for SigV4 auth";
		if (creds.aws_secret_access_key && !creds.aws_access_key_id)
			errors.aws_access_key_id = "Access Key ID is required when Secret Access Key is provided";
		if (creds.aws_access_key_id && !creds.aws_secret_access_key)
			errors.aws_secret_access_key = "Secret Access Key is required when Access Key ID is provided";
	}
	if (Array.isArray(values.static_headers))
		values.static_headers.forEach((value, index) => {
			const row = objectValue(value);
			if (!row.header) errors["static_headers." + index + ".header"] = "Header name is required";
			if (!row.value) errors["static_headers." + index + ".value"] = "Header value is required";
		});
	return errors;
}
export function mcpConnectionConfig(values: Record<string, unknown>) {
	const config: Record<string, unknown> = {
		server_id: values.server_id || "",
		server_name: values.server_name || "",
		url: values.url,
		spec_path: values.spec_path,
		transport: values.transport === "openapi" ? "http" : values.transport,
		auth_type: values.auth_type,
		authorization_url: values.authorization_url,
		token_url: values.token_url,
		registration_url: values.registration_url,
		mcp_info: values.mcp_info,
		static_headers: staticHeaders(values.static_headers),
	};
	const creds = normalizedCredentials(values.credentials);
	if (Object.keys(creds).length) config.credentials = creds;
	return config;
}
export function canTestMcp(values: Record<string, unknown>, token?: string | null) {
	const openapi = values.transport === "openapi",
		endpoint = openapi ? values.spec_path : values.url,
		needsToken = values.auth_type === "oauth2" && values.oauth_flow_type !== "m2m";
	return Boolean(endpoint && (openapi || (values.transport && values.auth_type && (!needsToken || token))));
}
export function maskedMcpUrl(url: string) {
	const pieces = url.split("/mcp/");
	return pieces.length === 2 && pieces[1] ? pieces[0] + "/mcp/..." : url;
}
