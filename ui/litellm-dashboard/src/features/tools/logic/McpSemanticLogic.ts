export const getCurlCommand = (testModel: string, testQuery: string) =>
	`curl --location 'http://localhost:4000/v1/responses' \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer sk-1234' \\
--data '{
    "model": "${testModel}",
    "input": [
    {
      "role": "user",
      "content": "${testQuery || "Your query here"}",
      "type": "message"
    }
  ],
    "tools": [
        {
            "type": "mcp",
            "server_url": "litellm_proxy",
            "require_approval": "never"
        }
    ],
    "tool_choice": "required"
}'`;

export function parseSemanticFilterHeaders(filter: string | null, tools: string | null) {
	if (!filter) return null;
	const [total, selected] = filter.split("->").map(Number);
	return { totalTools: total, selectedTools: selected, tools: tools ? tools.split(",").map((name) => name.trim()) : [] };
}
