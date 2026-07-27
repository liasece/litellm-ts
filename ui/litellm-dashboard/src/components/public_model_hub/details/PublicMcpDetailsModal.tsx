import { ExternalLinkIcon } from "@heroicons/react/outline";
import { Text } from "@tremor/react";
import { Modal, Tag, Tooltip } from "antd";
import { Copy } from "lucide-react";
import type { PublicMcpServer } from "../types";
import PublicCodeExample from "./PublicCodeExample";

interface PublicMcpDetailsModalProps {
	server: PublicMcpServer | null;
	open: boolean;
	onClose: () => void;
	onCopy: (value: string) => void;
}

function usageExample(serverName: string) {
	return `from fastmcp import Client
import asyncio

config = {
    "mcpServers": {
        "${serverName}": {
            "url": "http://localhost:4000/${serverName}/mcp",
            "headers": {"x-litellm-api-key": "Bearer sk-1234"},
        }
    }
}

client = Client(config)

async def main():
    async with client:
        tools = await client.list_tools()
        response = await client.call_tool(
            name="tool_name",
            arguments={"arg": "value"},
        )
        print(response)

if __name__ == "__main__":
    asyncio.run(main())`;
}

export default function PublicMcpDetailsModal({
	server,
	open,
	onClose,
	onCopy,
}: PublicMcpDetailsModalProps) {
	return (
		<Modal
			title={
				<div className="flex items-center space-x-2">
					<span>{server?.server_name || "MCP Server Details"}</span>
					{server && (
						<Tooltip title="Copy server name">
							<Copy
								onClick={() => onCopy(server.server_name)}
								className="h-4 w-4 cursor-pointer text-gray-500 hover:text-blue-500"
							/>
						</Tooltip>
					)}
				</div>
			}
			width={1000}
			open={open}
			footer={null}
			onCancel={onClose}
			destroyOnHidden
		>
			{server && (
				<div className="space-y-6">
					<section>
						<Text className="mb-4 text-lg font-semibold">Server Overview</Text>
						<div className="mb-4 grid grid-cols-2 gap-4">
							<div>
								<Text className="font-medium">Server Name:</Text>
								<Text>{server.server_name}</Text>
							</div>
							<div>
								<Text className="font-medium">Transport:</Text>
								<Tag color="blue">{server.transport}</Tag>
							</div>
							{server.alias && (
								<div>
									<Text className="font-medium">Alias:</Text>
									<Text>{server.alias}</Text>
								</div>
							)}
							<div>
								<Text className="font-medium">Auth Type:</Text>
								<Tag color={server.auth_type === "none" ? "gray" : "green"}>
									{server.auth_type}
								</Tag>
							</div>
							<div className="col-span-2">
								<Text className="font-medium">Description:</Text>
								<Text>{server.mcp_info?.description || "-"}</Text>
							</div>
							<a
								href={server.url}
								target="_blank"
								rel="noopener noreferrer"
								className="col-span-2 flex items-center space-x-2 break-all text-sm text-blue-600 hover:text-blue-800"
							>
								<span>{server.url}</span>
								<ExternalLinkIcon className="h-4 w-4" />
							</a>
						</div>
					</section>

					{Object.keys(server.mcp_info ?? {}).length > 0 && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Additional Information</Text>
							<div className="rounded-lg bg-gray-50 p-4">
								<pre className="overflow-x-auto text-xs">
									{JSON.stringify(server.mcp_info, null, 2)}
								</pre>
							</div>
						</section>
					)}

					<PublicCodeExample
						title="Usage Example"
						code={usageExample(server.server_name)}
						onCopy={onCopy}
					/>
				</div>
			)}
		</Modal>
	);
}

