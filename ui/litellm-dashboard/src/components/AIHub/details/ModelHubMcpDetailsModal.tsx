import type { MCPServerData } from "@/components/mcp_hub_table_columns";
import { getProxyBaseUrl } from "@/components/networking";
import { CopyOutlined } from "@ant-design/icons";
import { Badge, Text } from "@tremor/react";
import { Modal } from "antd";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

interface ModelHubMcpDetailsModalProps {
	server: MCPServerData | null;
	open: boolean;
	onClose: () => void;
	onCopy: (value: string) => void;
}

function statusColor(status: string) {
	if (status === "active" || status === "healthy") return "green";
	if (status === "inactive" || status === "unhealthy") return "red";
	return "gray";
}

function ResourceBadgeList({
	title,
	values,
	color,
}: {
	title: string;
	values: string[];
	color: "purple" | "blue" | "green";
}) {
	if (values.length === 0) return null;

	return (
		<section>
			<Text className="mb-4 text-lg font-semibold">{title}</Text>
			<div className="flex flex-wrap gap-2">
				{values.map((value) => (
					<Badge key={value} color={color}>
						{value}
					</Badge>
				))}
			</div>
		</section>
	);
}

export default function ModelHubMcpDetailsModal({ server, open, onClose, onCopy }: ModelHubMcpDetailsModalProps) {
	return (
		<Modal
			title={server?.server_name || "MCP Server Details"}
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
								<Text className="font-medium">Server ID:</Text>
								<div className="flex items-center space-x-2">
									<Text className="truncate text-xs">{server.server_id}</Text>
									<CopyOutlined
										onClick={() => onCopy(server.server_id)}
										className="cursor-pointer text-gray-500 hover:text-blue-500"
									/>
								</div>
							</div>
							{server.alias && (
								<div>
									<Text className="font-medium">Alias:</Text>
									<Text>{server.alias}</Text>
								</div>
							)}
							<div>
								<Text className="font-medium">Transport:</Text>
								<Badge color="blue">{server.transport}</Badge>
							</div>
							<div>
								<Text className="font-medium">Auth Type:</Text>
								<Badge color={server.auth_type === "none" ? "gray" : "green"}>{server.auth_type}</Badge>
							</div>
							<div>
								<Text className="font-medium">Status:</Text>
								<Badge color={statusColor(server.status)}>{server.status || "unknown"}</Badge>
							</div>
						</div>
						{server.description && (
							<div className="mt-2">
								<Text className="font-medium">Description:</Text>
								<Text className="mt-1">{server.description}</Text>
							</div>
						)}
					</section>

					<section>
						<Text className="mb-4 text-lg font-semibold">Connection Details</Text>
						<div className="space-y-2">
							<div>
								<Text className="font-medium">URL:</Text>
								<div className="mt-1 flex items-center space-x-2">
									<Text className="flex-1 break-all rounded bg-gray-100 p-2 text-sm">{server.url}</Text>
									<CopyOutlined
										onClick={() => onCopy(server.url)}
										className="flex-shrink-0 cursor-pointer text-gray-500 hover:text-blue-500"
									/>
								</div>
							</div>
							{server.command && (
								<div>
									<Text className="font-medium">Command:</Text>
									<Text className="mt-1 rounded bg-gray-100 p-2 font-mono text-sm">{server.command}</Text>
								</div>
							)}
						</div>
					</section>

					<ResourceBadgeList title="Allowed Tools" values={server.allowed_tools} color="purple" />
					<ResourceBadgeList title="Teams" values={server.teams} color="blue" />
					<ResourceBadgeList title="Access Groups" values={server.mcp_access_groups} color="green" />

					<section>
						<Text className="mb-4 text-lg font-semibold">Metadata</Text>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Text className="font-medium">Created By:</Text>
								<Text>{server.created_by}</Text>
							</div>
							<div>
								<Text className="font-medium">Updated By:</Text>
								<Text>{server.updated_by}</Text>
							</div>
							<div>
								<Text className="font-medium">Created At:</Text>
								<Text className="text-sm">{new Date(server.created_at).toLocaleString()}</Text>
							</div>
							<div>
								<Text className="font-medium">Updated At:</Text>
								<Text className="text-sm">{new Date(server.updated_at).toLocaleString()}</Text>
							</div>
							{server.last_health_check && (
								<div>
									<Text className="font-medium">Last Health Check:</Text>
									<Text className="text-sm">{new Date(server.last_health_check).toLocaleString()}</Text>
								</div>
							)}
						</div>
						{server.health_check_error && (
							<div className="mt-2 rounded bg-red-50 p-2">
								<Text className="font-medium text-red-700">Health Check Error:</Text>
								<Text className="mt-1 text-sm text-red-600">{server.health_check_error}</Text>
							</div>
						)}
					</section>

					<section>
						<Text className="mb-4 text-lg font-semibold">Usage Example</Text>
						<SyntaxHighlighter language="python" className="text-sm">
							{`from fastmcp import Client
import asyncio

config = {
    "mcpServers": {
        "${server.server_name}": {
            "url": "${getProxyBaseUrl()}/${server.server_name}/mcp",
            "headers": {"x-litellm-api-key": "Bearer sk-1234"}
        }
    }
}

client = Client(config)`}
						</SyntaxHighlighter>
					</section>
				</div>
			)}
		</Modal>
	);
}
