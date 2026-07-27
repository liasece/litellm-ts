import { CopyOutlined, EditOutlined } from "@ant-design/icons";
import { ExternalLinkIcon } from "@heroicons/react/outline";
import { Badge, Button, Card, Grid, Text, Title } from "@tremor/react";
import { Switch, Tooltip } from "antd";
import React, { useEffect, useState } from "react";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import NotificationsManager from "../molecules/notifications_manager";
import { disableClaudeCodePlugin, enableClaudeCodePlugin, getClaudeCodePluginDetails } from "../networking";
import AddPluginForm from "./add_plugin_form";
import {
	formatDateString,
	formatInstallCommand,
	getCategoryBadgeColor,
	getSourceDisplayText,
	getSourceLink,
} from "./helpers";
import { Plugin } from "./types";

interface PluginInfoViewProps {
	pluginId: string;
	onClose: () => void;
	accessToken: string | null;
	isAdmin: boolean;
	onPluginUpdated: () => void;
	onDelete: (pluginName: string, displayName: string) => void;
}

const PluginInfoView: React.FC<PluginInfoViewProps> = ({
	pluginId,
	onClose,
	accessToken,
	isAdmin,
	onPluginUpdated,
	onDelete,
}) => {
	const [plugin, setPlugin] = useState<Plugin | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [isToggling, setIsToggling] = useState(false);
	const [isEditing, setIsEditing] = useState(false);

	const fetchPluginInfo = React.useCallback(async () => {
		if (!accessToken) {
			setLoadError("No access token available");
			setIsLoading(false);
			return;
		}
		setIsLoading(true);
		setLoadError(null);
		try {
			const data = await getClaudeCodePluginDetails(accessToken, pluginId);
			setPlugin(data.plugin);
		} catch (error) {
			console.error("Error fetching plugin info:", error);
			setLoadError("Failed to load plugin information");
			NotificationsManager.error("Failed to load plugin information");
		} finally {
			setIsLoading(false);
		}
	}, [accessToken, pluginId]);

	useEffect(() => {
		void fetchPluginInfo();
	}, [pluginId, accessToken, fetchPluginInfo]);

	const handleToggleEnabled = async () => {
		if (!accessToken || !plugin) return;
		setIsToggling(true);
		try {
			if (plugin.enabled) {
				await disableClaudeCodePlugin(accessToken, plugin.name);
				NotificationsManager.success(`Plugin "${plugin.name}" disabled`);
			} else {
				await enableClaudeCodePlugin(accessToken, plugin.name);
				NotificationsManager.success(`Plugin "${plugin.name}" enabled`);
			}
			onPluginUpdated();
			await fetchPluginInfo();
		} catch (error) {
			NotificationsManager.error("Failed to toggle plugin status");
		} finally {
			setIsToggling(false);
		}
	};

	const handleEditSuccess = async () => {
		onPluginUpdated();
		await fetchPluginInfo();
	};

	const copyToClipboard = (text: string) => {
		navigator.clipboard.writeText(text);
		NotificationsManager.success("Copied to clipboard!");
	};

	const sourceLink = plugin ? getSourceLink(plugin.source) : undefined;
	const categoryBadgeColor = plugin?.category ? getCategoryBadgeColor(plugin.category) : "gray";

	return (
		<ResourceDetailsDrawer
			open
			onClose={onClose}
			title={plugin?.name || "Plugin details"}
			subtitle={plugin?.id || pluginId}
			loading={isLoading}
			error={loadError || (!isLoading && !plugin ? "Plugin not found" : undefined)}
			onRetry={() => void fetchPluginInfo()}
			actions={
				plugin && isAdmin ? (
					<>
						<Button icon={EditOutlined} onClick={() => setIsEditing(true)}>
							Edit
						</Button>
						<Button color="red" onClick={() => onDelete(plugin.name, plugin.name)}>
							Delete
						</Button>
					</>
				) : undefined
			}
		>
			{plugin && (
				<div className="space-y-4 p-4">
					<div className="flex items-center gap-3">
						<Title>{plugin.name}</Title>
						{plugin.version && (
							<Badge color="blue" size="xs">
								v{plugin.version}
							</Badge>
						)}
						{plugin.category && (
							<Badge color={categoryBadgeColor} size="xs">
								{plugin.category}
							</Badge>
						)}
						<Badge color={plugin.enabled ? "green" : "gray"} size="xs">
							{plugin.enabled ? "Enabled" : "Disabled"}
						</Badge>
					</div>
					<Card>
						<div className="flex items-center justify-between">
							<div className="flex-1">
								<Text className="text-gray-600 text-xs mb-2">Install Command</Text>
								<div className="font-mono bg-gray-100 px-3 py-2 rounded text-sm">{formatInstallCommand(plugin)}</div>
							</div>
							<Tooltip title="Copy install command">
								<Button
									size="xs"
									variant="secondary"
									icon={CopyOutlined}
									onClick={() => copyToClipboard(formatInstallCommand(plugin))}
									className="ml-4"
								>
									Copy
								</Button>
							</Tooltip>
						</div>
					</Card>
					<Card>
						<Title>Plugin Details</Title>
						<Grid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
							<div>
								<Text className="text-gray-600 text-xs">Plugin ID</Text>
								<div className="flex items-center gap-2 mt-1">
									<Text className="font-mono text-xs">{plugin.id}</Text>
									<CopyOutlined
										className="cursor-pointer text-gray-500 hover:text-blue-500 text-xs"
										onClick={() => copyToClipboard(plugin.id)}
									/>
								</div>
							</div>
							<div>
								<Text className="text-gray-600 text-xs">Name</Text>
								<Text className="font-semibold mt-1">{plugin.name}</Text>
							</div>
							<div>
								<Text className="text-gray-600 text-xs">Version</Text>
								<Text className="font-semibold mt-1">{plugin.version || "N/A"}</Text>
							</div>
							<div className="col-span-2">
								<Text className="text-gray-600 text-xs">Source</Text>
								<div className="flex items-center gap-2 mt-1">
									<Text className="font-semibold">{getSourceDisplayText(plugin.source)}</Text>
									{sourceLink && (
										<a
											href={sourceLink}
											target="_blank"
											rel="noopener noreferrer"
											className="text-blue-500 hover:text-blue-700"
										>
											<ExternalLinkIcon className="h-4 w-4" />
										</a>
									)}
								</div>
							</div>
							<div>
								<Text className="text-gray-600 text-xs">Category</Text>
								<div className="mt-1">
									{plugin.category ? (
										<Badge color={categoryBadgeColor} size="xs">
											{plugin.category}
										</Badge>
									) : (
										<Text className="text-gray-400">Uncategorized</Text>
									)}
								</div>
							</div>
							{isAdmin && (
								<div className="col-span-3">
									<Text className="text-gray-600 text-xs">Status</Text>
									<div className="flex items-center gap-3 mt-2">
										<Switch checked={plugin.enabled} loading={isToggling} onChange={handleToggleEnabled} />
										<Text className="text-sm">
											{plugin.enabled
												? "Plugin is enabled and visible in marketplace"
												: "Plugin is disabled and hidden from marketplace"}
										</Text>
									</div>
								</div>
							)}
						</Grid>
					</Card>
					{plugin.description && (
						<Card>
							<Title>Description</Title>
							<Text className="mt-2">{plugin.description}</Text>
						</Card>
					)}
					{plugin.keywords?.length ? (
						<Card>
							<Title>Keywords</Title>
							<div className="flex flex-wrap gap-2 mt-2">
								{plugin.keywords.map((keyword) => (
									<Badge key={keyword} color="gray" size="xs">
										{keyword}
									</Badge>
								))}
							</div>
						</Card>
					) : null}
					{plugin.author && (
						<Card>
							<Title>Author Information</Title>
							<Grid className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
								{plugin.author.name && (
									<div>
										<Text className="text-gray-600 text-xs">Name</Text>
										<Text className="font-semibold mt-1">{plugin.author.name}</Text>
									</div>
								)}
								{plugin.author.email && (
									<div>
										<Text className="text-gray-600 text-xs">Email</Text>
										<a href={`mailto:${plugin.author.email}`} className="text-blue-500 hover:text-blue-700">
											{plugin.author.email}
										</a>
									</div>
								)}
							</Grid>
						</Card>
					)}
					{plugin.homepage && (
						<Card>
							<Title>Homepage</Title>
							<a
								href={plugin.homepage}
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-500 hover:text-blue-700 flex items-center gap-2 mt-2"
							>
								{plugin.homepage}
								<ExternalLinkIcon className="h-4 w-4" />
							</a>
						</Card>
					)}
					<Card>
						<Title>Metadata</Title>
						<Grid className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
							<div>
								<Text className="text-gray-600 text-xs">Created At</Text>
								<Text className="font-semibold mt-1">{formatDateString(plugin.created_at)}</Text>
							</div>
							<div>
								<Text className="text-gray-600 text-xs">Updated At</Text>
								<Text className="font-semibold mt-1">{formatDateString(plugin.updated_at)}</Text>
							</div>
							{plugin.created_by && (
								<div className="col-span-2">
									<Text className="text-gray-600 text-xs">Created By</Text>
									<Text className="font-semibold mt-1">{plugin.created_by}</Text>
								</div>
							)}
						</Grid>
					</Card>
					<AddPluginForm
						visible={isEditing}
						onClose={() => setIsEditing(false)}
						accessToken={accessToken}
						onSuccess={handleEditSuccess}
						initialPlugin={plugin}
					/>
				</div>
			)}
		</ResourceDetailsDrawer>
	);
};

export default PluginInfoView;
