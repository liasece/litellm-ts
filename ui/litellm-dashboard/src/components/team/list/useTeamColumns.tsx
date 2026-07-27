import TableIconActionButton from "@/components/common_components/IconActionButton/TableIconActionButtons/TableIconActionButton";
import type { KeyResponse, Team } from "@/components/key_team_helpers/key_list";
import type { Member, Organization } from "@/components/networking";
import type { ColumnsType } from "antd/es/table";
import { Flex, Progress, Space, Tag, Tooltip, Typography, message } from "antd";
import { KeyIcon, LayersIcon, UsersIcon } from "lucide-react";
import { useMemo } from "react";

interface TeamResourceInfo {
	keys: KeyResponse[];
	team_info: {
		members_with_roles: Member[];
	};
}

interface UseTeamColumnsOptions {
	userRole: string | null;
	organizations: Organization[] | null | undefined;
	perTeamInfo: Record<string, TeamResourceInfo>;
	onOpen: (teamId: string, edit: boolean) => void;
	onDelete: (team: Team) => void;
}

const getOrganizationAlias = (
	organizationId: string | null | undefined,
	organizations: Organization[] | null | undefined,
) => {
	if (!organizationId || !organizations) return organizationId || "N/A";
	return (
		organizations.find((organization) => organization.organization_id === organizationId)?.organization_alias ||
		organizationId
	);
};

export default function useTeamColumns({
	userRole,
	organizations,
	perTeamInfo,
	onOpen,
	onDelete,
}: UseTeamColumnsOptions): ColumnsType<Team> {
	const { Text } = Typography;

	return useMemo(
		() => [
			{
				title: "Team ID",
				dataIndex: "team_id",
				key: "team_id",
				width: 170,
				ellipsis: true,
				render: (id: string, team: Team) => (
					<Tooltip title={id}>
						<Text
							ellipsis
							className="cursor-pointer bg-blue-50 text-xs text-blue-500 hover:bg-blue-100"
							style={{ fontSize: 14, padding: "1px 8px" }}
							onClick={() => onOpen(team.team_id, false)}
						>
							{id}
						</Text>
					</Tooltip>
				),
			},
			{
				title: "Team Alias",
				dataIndex: "team_alias",
				key: "team_alias",
				ellipsis: true,
				sorter: true,
				render: (alias?: string) => (
					<Text style={{ fontSize: 14 }}>
						{alias || (
							<Text type="secondary" italic>
								—
							</Text>
						)}
					</Text>
				),
			},
			{
				title: "Organization",
				key: "organization",
				width: 160,
				ellipsis: true,
				render: (_: unknown, team: Team) =>
					team.organization_id ? (
						<Text ellipsis style={{ fontSize: 14 }}>
							{getOrganizationAlias(team.organization_id, organizations)}
						</Text>
					) : (
						<Text type="secondary">—</Text>
					),
			},
			{
				title: "Resources",
				key: "resources",
				width: 240,
				render: (_: unknown, team: Team) => {
					const memberCount = perTeamInfo[team.team_id]?.team_info.members_with_roles.length ?? 0;
					const modelCount = team.models?.length ?? 0;
					const keyCount = perTeamInfo[team.team_id]?.keys.length ?? 0;
					return (
						<Flex gap={12} align="center">
							<Tooltip title={`${memberCount} Members`}>
								<Tag color="purple" style={{ fontSize: 14, padding: "2px 8px", margin: 0 }}>
									<Flex align="center" gap={6}>
										<UsersIcon size={14} />
										{memberCount}
									</Flex>
								</Tag>
							</Tooltip>
							<Tooltip title={`${modelCount} Models`}>
								<Tag color="blue" style={{ fontSize: 14, padding: "2px 8px", margin: 0 }}>
									<Flex align="center" gap={6}>
										<LayersIcon size={14} />
										{modelCount}
									</Flex>
								</Tag>
							</Tooltip>
							<Tooltip title={`${keyCount} Keys`}>
								<Tag color="cyan" style={{ fontSize: 14, padding: "2px 8px", margin: 0 }}>
									<Flex align="center" gap={6}>
										<KeyIcon size={14} />
										{keyCount}
									</Flex>
								</Tag>
							</Tooltip>
						</Flex>
					);
				},
			},
			{
				title: "Spend / Budget",
				key: "spend",
				width: 200,
				sorter: true,
				render: (_: unknown, team: Team) => {
					const spend = team.spend ?? 0;
					const budget = team.max_budget;
					const percentage = budget != null && budget > 0 ? Math.min((spend / budget) * 100, 100) : null;
					return (
						<Flex vertical gap={2}>
							<Text style={{ fontSize: 13 }}>
								${spend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
								<Text type="secondary" style={{ fontSize: 12 }}>
									{" / "}
									{budget == null
										? "Unlimited"
										: `$${budget.toLocaleString(undefined, {
												minimumFractionDigits: 2,
												maximumFractionDigits: 2,
											})}`}
								</Text>
							</Text>
							{percentage != null && (
								<Progress
									percent={percentage}
									size="small"
									showInfo={false}
									strokeColor={percentage >= 90 ? "#ff4d4f" : percentage >= 70 ? "#faad14" : "#1677ff"}
									style={{ marginBottom: 0 }}
								/>
							)}
						</Flex>
					);
				},
			},
			{
				title: "Created",
				dataIndex: "created_at",
				key: "created_at",
				width: 130,
				ellipsis: true,
				sorter: true,
				render: (date?: string) => (
					<Text type="secondary" style={{ fontSize: 13 }}>
						{date
							? new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
							: "—"}
					</Text>
				),
			},
			{
				title: "Actions",
				key: "actions",
				width: 120,
				align: "right" as const,
				render: (_: unknown, team: Team) => (
					<Space size={4}>
						<TableIconActionButton
							variant="Copy"
							tooltipText="Copy Team ID"
							onClick={() => {
								navigator.clipboard
									.writeText(team.team_id)
									.then(() => message.success("Team ID copied"))
									.catch(() => message.error("Failed to copy"));
							}}
						/>
						{userRole === "Admin" && (
							<>
								<TableIconActionButton
									variant="Edit"
									tooltipText="Edit team"
									dataTestId="edit-team-button"
									onClick={() => onOpen(team.team_id, true)}
								/>
								<TableIconActionButton
									variant="Delete"
									tooltipText="Delete team"
									dataTestId="delete-team-button"
									onClick={() => onDelete(team)}
								/>
							</>
						)}
					</Space>
				),
			},
		],
		[Text, onDelete, onOpen, organizations, perTeamInfo, userRole],
	);
}
