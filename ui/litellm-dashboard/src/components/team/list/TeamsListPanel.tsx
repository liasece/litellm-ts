import AvailableTeamsPanel from "@/components/team/available_teams";
import TeamSSOSettings from "@/components/TeamSSOSettings";
import { AntDLoadingSpinner } from "@/components/ui/AntDLoadingSpinner";
import { ReloadOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";
import type { Team } from "@/components/key_team_helpers/key_list";
import type { Organization } from "@/components/networking";
import type { ColumnsType, TableProps } from "antd/es/table";
import { Button, Card, Flex, Input, Pagination, Table, Tabs, Typography } from "antd";
import DeleteResourceModal from "../../common_components/DeleteResourceModal";
import OrganizationDropdown from "../../common_components/OrganizationDropdown";

interface TeamsListPanelProps {
	teams: Team[];
	columns: ColumnsType<Team>;
	loading: boolean;
	searching: boolean;
	error: string | null;
	organizations: Organization[] | null;
	organizationId: string;
	currentPage: number;
	pageSize: number;
	totalTeams: number;
	canCreate: boolean;
	accessToken: string | null;
	userId: string | null;
	userRole: string | null;
	showAdminSettings: boolean;
	teamToDelete: Team | null;
	deleting: boolean;
	onSearch: (value: string) => void;
	onOrganizationChange: (organizationId: string) => void;
	onPageChange: (page: number, pageSize: number) => void;
	onSort: NonNullable<TableProps<Team>["onChange"]>;
	onRetry: () => void;
	onCreate: () => void;
	onDeleteCancel: () => void;
	onDeleteConfirm: () => void | Promise<void>;
}

function TeamsTableState({ loading, error, onRetry }: Pick<TeamsListPanelProps, "loading" | "error" | "onRetry">) {
	const { Text } = Typography;

	if (loading) {
		return (
			<Flex justify="center" align="center" style={{ padding: "80px 0" }}>
				<AntDLoadingSpinner fontSize={48} />
			</Flex>
		);
	}

	if (error) {
		return (
			<Flex vertical align="center" gap={16} style={{ padding: "64px 0" }}>
				<Text type="danger" style={{ fontSize: 15 }}>
					Failed to load teams
				</Text>
				<Text type="secondary" style={{ fontSize: 13 }}>
					{error}
				</Text>
				<Button icon={<ReloadOutlined />} onClick={onRetry}>
					Retry
				</Button>
			</Flex>
		);
	}

	return null;
}

export default function TeamsListPanel(props: TeamsListPanelProps) {
	const { Text } = Typography;
	const listContent =
		props.loading || props.error ? (
			<TeamsTableState loading={props.loading} error={props.error} onRetry={props.onRetry} />
		) : (
			<Table<Team>
				columns={props.columns}
				dataSource={props.teams}
				rowKey="team_id"
				pagination={false}
				onChange={props.onSort}
				locale={{
					emptyText: (
						<div className="py-16 text-center">
							<TeamOutlined className="mb-3 text-[40px] text-gray-300" />
							<div>
								<Text className="text-[15px] text-gray-600">No teams yet</Text>
							</div>
							<div className="mt-1">
								<Text type="secondary" className="text-[13px]">
									Create your first team to organize members and manage access to models.
								</Text>
							</div>
							{props.canCreate && (
								<Button type="primary" onClick={props.onCreate} className="mt-4">
									Create Team
								</Button>
							)}
						</div>
					),
				}}
				scroll={{ x: 1000 }}
				size="middle"
			/>
		);

	const tabs = [
		{
			key: "your-teams",
			label: "Your Teams",
			children: (
				<>
					<Card styles={{ body: { padding: 0 } }}>
						<Flex justify="space-between" align="center" wrap gap={12} className="px-4 py-3">
							<Flex gap={12} align="center" wrap className="min-w-0 flex-1">
								<Input
									prefix={<SearchOutlined />}
									suffix={props.searching ? <AntDLoadingSpinner size="small" /> : null}
									placeholder="Search teams by name..."
									onChange={(event) => props.onSearch(event.target.value)}
									allowClear
									className="min-w-[220px] max-w-[400px] flex-1"
								/>
								<OrganizationDropdown
									organizations={props.organizations}
									value={props.organizationId || undefined}
									onChange={(value: string) => props.onOrganizationChange(value || "")}
									loading={props.loading}
								/>
							</Flex>
							<Pagination
								current={props.currentPage}
								total={props.totalTeams}
								pageSize={props.pageSize}
								onChange={props.onPageChange}
								size="small"
								showTotal={(total) => `${total} teams`}
								showSizeChanger
								pageSizeOptions={["10", "20", "50"]}
							/>
						</Flex>
						{listContent}
					</Card>
					<DeleteResourceModal
						isOpen={Boolean(props.teamToDelete)}
						title="Delete Team?"
						alertMessage={
							props.teamToDelete?.keys?.length === 0
								? undefined
								: `Warning: This team has ${props.teamToDelete?.keys?.length} keys associated with it. Deleting the team will also delete all associated keys. This action is irreversible.`
						}
						message="Are you sure you want to delete this team and all its keys? This action cannot be undone."
						resourceInformationTitle="Team Information"
						resourceInformation={[
							{ label: "Team ID", value: props.teamToDelete?.team_id, code: true },
							{ label: "Team Name", value: props.teamToDelete?.team_alias },
							{ label: "Keys", value: props.teamToDelete?.keys?.length },
							{ label: "Members", value: props.teamToDelete?.members_with_roles?.length },
						]}
						requiredConfirmation={props.teamToDelete?.team_alias}
						onCancel={props.onDeleteCancel}
						onOk={props.onDeleteConfirm}
						confirmLoading={props.deleting}
					/>
				</>
			),
		},
		{
			key: "available-teams",
			label: "Available Teams",
			children: <AvailableTeamsPanel accessToken={props.accessToken} userID={props.userId} />,
		},
		...(props.showAdminSettings
			? [
					{
						key: "default-settings",
						label: "Default Team Settings",
						children: (
							<TeamSSOSettings
								accessToken={props.accessToken}
								userID={props.userId || ""}
								userRole={props.userRole || ""}
							/>
						),
					},
				]
			: []),
	];

	return <Tabs items={tabs} />;
}
