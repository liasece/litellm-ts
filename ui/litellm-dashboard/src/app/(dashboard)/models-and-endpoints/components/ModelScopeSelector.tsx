import { Team } from "@/components/key_team_helpers/key_list";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Badge, Select, Skeleton, Space, Typography } from "antd";

const { Text } = Typography;

export type ModelViewMode = "all" | "current_team";

interface ModelScopeSelectorProps {
	currentTeam: Team | "personal";
	teams?: Team[];
	modelViewMode: ModelViewMode;
	isLoading: boolean;
	isLoadingTeams: boolean;
	onCurrentTeamChange: (team: Team | "personal") => void;
	onViewModeChange: (mode: ModelViewMode) => void;
}

export default function ModelScopeSelector({
	currentTeam,
	teams,
	modelViewMode,
	isLoading,
	isLoadingTeams,
	onCurrentTeamChange,
	onViewModeChange,
}: ModelScopeSelectorProps) {
	return (
		<div className="border-b bg-gray-50 px-6 py-4">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-4">
					<Text className="text-lg font-semibold text-gray-900">Current Team:</Text>
					<div className="w-80">
						{isLoading ? (
							<Skeleton.Input active block size="large" />
						) : (
							<Select
								style={{ width: "100%" }}
								size="large"
								value={currentTeam === "personal" ? "personal" : currentTeam.team_id}
								onChange={(value) => {
									if (value === "personal") {
										onCurrentTeamChange("personal");
										return;
									}
									const selectedTeam = teams?.find((team) => team.team_id === value);
									if (selectedTeam) onCurrentTeamChange(selectedTeam);
								}}
								loading={isLoadingTeams}
								options={[
									{
										value: "personal",
										label: (
											<Space direction="horizontal" align="center">
												<Badge color="blue" size="small" />
												<Text style={{ fontSize: 16 }}>Personal</Text>
											</Space>
										),
									},
									...(teams
										?.filter((team) => team.team_id)
										.map((team) => ({
											value: team.team_id,
											label: (
												<Space direction="horizontal" align="center">
													<Badge color="green" size="small" />
													<Text ellipsis style={{ fontSize: 16 }}>
														{team.team_alias || team.team_id}
													</Text>
												</Space>
											),
										})) ?? []),
								]}
							/>
						)}
					</div>
				</div>
				<div className="flex items-center gap-4">
					<Text className="text-lg font-semibold text-gray-900">View:</Text>
					<div className="w-64">
						{isLoading ? (
							<Skeleton.Input active block size="large" />
						) : (
							<Select
								style={{ width: "100%" }}
								size="large"
								value={modelViewMode}
								onChange={onViewModeChange}
								options={[
									{
										value: "current_team",
										label: (
											<Space direction="horizontal" align="center">
												<Badge color="purple" size="small" />
												<Text style={{ fontSize: 16 }}>Current Team Models</Text>
											</Space>
										),
									},
									{
										value: "all",
										label: (
											<Space direction="horizontal" align="center">
												<Badge color="gray" size="small" />
												<Text style={{ fontSize: 16 }}>All Available Models</Text>
											</Space>
										),
									},
								]}
							/>
						)}
					</div>
				</div>
			</div>

			{modelViewMode === "current_team" && (
				<div className="mt-3 flex items-start gap-2">
					<InfoCircleOutlined className="mt-0.5 flex-shrink-0 text-xs text-gray-400" />
					<div className="text-xs text-gray-500">
						To access these models: Create a Virtual Key
						{currentTeam !== "personal" && (
							<> and select Team as &quot;{currentTeam.team_alias || currentTeam.team_id}&quot;</>
						)}{" "}
						on the{" "}
						<a href="/public?login=success&page=api-keys" className="text-gray-600 underline hover:text-gray-800">
							Virtual Keys page
						</a>
					</div>
				</div>
			)}
		</div>
	);
}
