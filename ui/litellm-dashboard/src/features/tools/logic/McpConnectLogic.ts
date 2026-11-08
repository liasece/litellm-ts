export function mcpConnectionExamples(proxyBaseUrl: string) {
	return {
		litellm: `curl --location '${proxyBaseUrl}/v1/responses' \\
--header 'Content-Type: application/json' \\
--header "Authorization: Bearer $LITELLM_VIRTUAL_KEY" \\
--data '{
    "model": "gpt-4",
    "tools": [
        {
            "type": "mcp",
            "server_label": "litellm",
            "server_url": "litellm_proxy",
            "require_approval": "never",
            "headers": {
                "x-litellm-api-key": "Bearer YOUR_LITELLM_VIRTUAL_KEY",
                "x-mcp-servers": "Zapier_MCP,dev-group"
            }
        }
    ],
    "input": "Run available tools",
    "tool_choice": "required"
}'`,
		openai: `curl --location 'https://api.openai.com/v1/responses' \\
--header 'Content-Type: application/json' \\
--header "Authorization: Bearer $OPENAI_API_KEY" \\
--data '{
    "model": "gpt-4.1",
    "tools": [
        {
            "type": "mcp",
            "server_label": "litellm",
            "server_url": "${proxyBaseUrl}/mcp",
            "require_approval": "never",
            "headers": {
                "x-litellm-api-key": "Bearer YOUR_LITELLM_API_KEY",
                "x-mcp-servers": "Zapier_MCP,dev-group"
            }
        }
    ],
    "input": "Run available tools",
    "tool_choice": "required"
}'`,
		cursor: `{
  "mcpServers": {
    "Zapier_MCP": {
      "url": "${proxyBaseUrl}/mcp",
      "headers": {
        "x-litellm-api-key": "Bearer YOUR_LITELLM_API_KEY",
        "x-mcp-servers": "Zapier_MCP,dev-group"
      }
    }
  }
}`,
	};
}
export function mcpExampleHeaders(code: string, serverName: string, enabled: boolean) {
	const headers: Record<string, string> = { "x-litellm-api-key": "Bearer YOUR_LITELLM_API_KEY" };
	if (enabled) headers["x-mcp-servers"] = serverName.replace(/\s+/g, "_") + ",dev-group";
	return code.replace(/"headers":\s*{[^}]*}/, '"headers": ' + JSON.stringify(headers, null, 8));
}
