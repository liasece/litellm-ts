import ProviderLogo from "@/components/common_components/ProviderLogo";
import { getModelLogoAndName } from "@/components/provider_info_helpers";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Text } from "@tremor/react";
import { Tag, Tooltip } from "antd";
import { Copy } from "lucide-react";
import { formatCapabilityName } from "./filters";
import type { PublicAgentCard, PublicMcpServer, PublicModelInfo } from "./types";

function formatCost(cost: number) {
	return `$${(cost * 1_000_000).toFixed(4)}`;
}

function formatTokens(tokens?: number) {
	if (!tokens) return "N/A";
	return tokens >= 1000 ? `${(tokens / 1000).toFixed(0)}K` : tokens.toString();
}

function formatLimits(rpm?: number, tpm?: number) {
	const limits = [];
	if (rpm) limits.push(`RPM: ${rpm.toLocaleString()}`);
	if (tpm) limits.push(`TPM: ${tpm.toLocaleString()}`);
	return limits.length ? limits.join(", ") : "N/A";
}

function modeIcon(mode?: string) {
	switch (mode?.toLowerCase()) {
		case "chat":
			return "💬";
		case "rerank":
			return "🔄";
		case "embedding":
			return "📄";
		default:
			return "🤖";
	}
}

function OverflowTags({ values, color, label }: { values: string[]; color: "blue" | "purple"; label: string }) {
	if (values.length === 0) return <Text className="text-gray-400">-</Text>;

	return (
		<div className="flex h-6 items-center space-x-1">
			<Tag color={color} className="text-xs">
				{values[0]}
			</Tag>
			{values.length > 1 && (
				<Tooltip
					title={
						<div className="space-y-1">
							<div className="font-medium">All {label}:</div>
							{values.map((value) => (
								<div key={value} className="text-xs">
									• {value}
								</div>
							))}
						</div>
					}
					trigger="click"
					placement="topLeft"
				>
					<span
						className={`cursor-pointer text-xs hover:underline ${
							color === "blue" ? "text-blue-600 hover:text-blue-800" : "text-purple-600 hover:text-purple-800"
						}`}
						onClick={(event) => event.stopPropagation()}
					>
						+{values.length - 1}
					</span>
				</Tooltip>
			)}
		</div>
	);
}

export function getPublicModelColumns(onSelect: (model: PublicModelInfo) => void): ColumnDef<PublicModelInfo>[] {
	return [
		{
			header: "Model Name",
			accessorKey: "model_group",
			enableSorting: true,
			cell: ({ row }) => (
				<div className="overflow-hidden">
					<Tooltip title={row.original.model_group}>
						<Button
							size="xs"
							variant="light"
							className="bg-blue-50 px-2 py-0.5 text-left font-mono text-xs font-normal text-blue-500 hover:bg-blue-100"
							onClick={() => onSelect(row.original)}
						>
							{row.original.model_group}
						</Button>
					</Tooltip>
				</div>
			),
			size: 150,
		},
		{
			header: "Providers",
			accessorKey: "providers",
			enableSorting: true,
			cell: ({ row }) => (
				<div className="flex flex-wrap gap-1">
					{(row.original.providers ?? []).map((provider) => {
						const { logo } = getModelLogoAndName(provider, row.original.model_group);
						return (
							<div key={provider} className="flex items-center space-x-1 rounded bg-gray-100 px-2 py-1 text-xs">
								<ProviderLogo
									provider={provider}
									logo={logo}
									className="h-3 w-3 flex-shrink-0 object-contain"
									fallbackClassName="hidden"
								/>
								<span className="capitalize">{provider}</span>
							</div>
						);
					})}
				</div>
			),
			size: 120,
		},
		{
			header: "Mode",
			accessorKey: "mode",
			enableSorting: true,
			cell: ({ row }) => (
				<div className="flex items-center space-x-2">
					<span>{modeIcon(row.original.mode)}</span>
					<Text>{row.original.mode || "Chat"}</Text>
				</div>
			),
			size: 100,
		},
		{
			header: "Max Input",
			accessorKey: "max_input_tokens",
			enableSorting: true,
			cell: ({ row }) => <Text className="text-center">{formatTokens(row.original.max_input_tokens)}</Text>,
			size: 100,
			meta: { className: "text-center" },
		},
		{
			header: "Max Output",
			accessorKey: "max_output_tokens",
			enableSorting: true,
			cell: ({ row }) => <Text className="text-center">{formatTokens(row.original.max_output_tokens)}</Text>,
			size: 100,
			meta: { className: "text-center" },
		},
		{
			header: "Input $/1M",
			accessorKey: "input_cost_per_token",
			enableSorting: true,
			cell: ({ row }) => (
				<Text className="text-center">
					{row.original.input_cost_per_token ? formatCost(row.original.input_cost_per_token) : "Free"}
				</Text>
			),
			size: 100,
			meta: { className: "text-center" },
		},
		{
			header: "Output $/1M",
			accessorKey: "output_cost_per_token",
			enableSorting: true,
			cell: ({ row }) => (
				<Text className="text-center">
					{row.original.output_cost_per_token ? formatCost(row.original.output_cost_per_token) : "Free"}
				</Text>
			),
			size: 100,
			meta: { className: "text-center" },
		},
		{
			header: "Features",
			id: "features",
			enableSorting: false,
			cell: ({ row }) => (
				<OverflowTags
					values={Object.entries(row.original)
						.filter(([key, value]) => key.startsWith("supports_") && value === true)
						.map(([key]) => formatCapabilityName(key))}
					color="blue"
					label="Features"
				/>
			),
			size: 120,
		},
		{
			header: "Health Status",
			accessorKey: "health_status",
			enableSorting: true,
			cell: ({ row }) => {
				const model = row.original;
				const tagColor =
					model.health_status === "healthy" ? "green" : model.health_status === "unhealthy" ? "red" : "default";
				return (
					<Tooltip
						title={
							<>
								<div>
									{model.health_response_time
										? `Response Time: ${Number(model.health_response_time).toFixed(2)}ms`
										: "N/A"}
								</div>
								<div>
									{model.health_checked_at
										? `Last Checked: ${new Date(model.health_checked_at).toLocaleString()}`
										: "N/A"}
								</div>
							</>
						}
					>
						<Tag color={tagColor}>
							<span className="capitalize">{model.health_status ?? "Unknown"}</span>
						</Tag>
					</Tooltip>
				);
			},
			size: 100,
		},
		{
			header: "Limits",
			accessorKey: "rpm",
			enableSorting: true,
			cell: ({ row }) => (
				<Text className="text-xs text-gray-600">{formatLimits(row.original.rpm, row.original.tpm)}</Text>
			),
			size: 150,
		},
	];
}

export function getPublicAgentColumns(onSelect: (agent: PublicAgentCard) => void): ColumnDef<PublicAgentCard>[] {
	return [
		{
			header: "Agent Name",
			accessorKey: "name",
			enableSorting: true,
			cell: ({ row }) => (
				<Tooltip title={row.original.name}>
					<Button
						size="xs"
						variant="light"
						className="bg-blue-50 px-2 py-0.5 text-left font-mono text-xs font-normal text-blue-500 hover:bg-blue-100"
						onClick={() => onSelect(row.original)}
					>
						{row.original.name}
					</Button>
				</Tooltip>
			),
			size: 150,
		},
		{
			header: "Description",
			accessorKey: "description",
			enableSorting: false,
			cell: ({ row }) => {
				const description = row.original.description ?? "";
				return (
					<Tooltip title={description}>
						<Text className="text-sm text-gray-700">
							{description.length > 80 ? `${description.substring(0, 80)}...` : description}
						</Text>
					</Tooltip>
				);
			},
			size: 250,
		},
		{
			header: "Version",
			accessorKey: "version",
			enableSorting: true,
			cell: ({ row }) => <Text className="text-sm">{row.original.version}</Text>,
			size: 80,
		},
		{
			header: "Provider",
			accessorKey: "provider",
			enableSorting: false,
			cell: ({ row }) =>
				row.original.provider ? (
					<Text className="text-sm font-medium">{row.original.provider.organization}</Text>
				) : (
					<Text className="text-gray-400">-</Text>
				),
			size: 120,
		},
		{
			header: "Skills",
			accessorKey: "skills",
			enableSorting: false,
			cell: ({ row }) => (
				<OverflowTags values={(row.original.skills ?? []).map((skill) => skill.name)} color="purple" label="Skills" />
			),
			size: 150,
		},
		{
			header: "Capabilities",
			accessorKey: "capabilities",
			enableSorting: false,
			cell: ({ row }) => {
				const capabilities = Object.entries(row.original.capabilities ?? {})
					.filter(([, value]) => value === true)
					.map(([key]) => key);
				return capabilities.length ? (
					<div className="flex flex-wrap gap-1">
						{capabilities.map((capability) => (
							<Tag key={capability} color="green" className="text-xs capitalize">
								{capability}
							</Tag>
						))}
					</div>
				) : (
					<Text className="text-gray-400">-</Text>
				);
			},
			size: 150,
		},
	];
}

export function getPublicMcpColumns(
	onSelect: (server: PublicMcpServer) => void,
	onCopy: (value: string) => void,
): ColumnDef<PublicMcpServer>[] {
	return [
		{
			header: "Server Name",
			accessorKey: "server_name",
			enableSorting: true,
			cell: ({ row }) => (
				<Tooltip title={row.original.server_name}>
					<Button
						size="xs"
						variant="light"
						className="bg-blue-50 px-2 py-0.5 text-left font-mono text-xs font-normal text-blue-500 hover:bg-blue-100"
						onClick={() => onSelect(row.original)}
					>
						{row.original.server_name}
					</Button>
				</Tooltip>
			),
			size: 150,
		},
		{
			header: "Description",
			accessorKey: "mcp_info.description",
			enableSorting: false,
			cell: ({ row }) => {
				const description = String(row.original.mcp_info?.description ?? "-");
				return (
					<Tooltip title={description}>
						<Text className="text-sm text-gray-700">
							{description.length > 80 ? `${description.substring(0, 80)}...` : description}
						</Text>
					</Tooltip>
				);
			},
			size: 250,
		},
		{
			header: "URL",
			accessorKey: "url",
			enableSorting: false,
			cell: ({ row }) => {
				const url = row.original.url ?? "";
				return (
					<Tooltip title={url}>
						<div className="flex items-center space-x-2">
							<Text className="font-mono text-xs">{url.length > 40 ? `${url.substring(0, 40)}...` : url}</Text>
							<Copy onClick={() => onCopy(url)} className="h-3 w-3 cursor-pointer text-gray-500 hover:text-blue-500" />
						</div>
					</Tooltip>
				);
			},
			size: 200,
		},
		{
			header: "Transport",
			accessorKey: "transport",
			enableSorting: true,
			cell: ({ row }) => (
				<Tag color="blue" className="text-xs uppercase">
					{row.original.transport}
				</Tag>
			),
			size: 100,
		},
		{
			header: "Auth Type",
			accessorKey: "auth_type",
			enableSorting: true,
			cell: ({ row }) => (
				<Tag color={row.original.auth_type === "none" ? "gray" : "green"} className="text-xs capitalize">
					{row.original.auth_type}
				</Tag>
			),
			size: 100,
		},
	];
}
