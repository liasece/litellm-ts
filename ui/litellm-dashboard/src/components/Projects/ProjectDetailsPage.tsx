import { useProjectDetails } from "@/app/(dashboard)/hooks/projects/useProjectDetails";
import { useTeam } from "@/app/(dashboard)/hooks/teams/useTeams";
import { Button, Flex, Layout, Tag, Typography } from "antd";
import { EditIcon } from "lucide-react";
import { useMemo, useState } from "react";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import ProjectMetadataCard from "./details/ProjectMetadataCard";
import ProjectResourcesSection from "./details/ProjectResourcesSection";
import ProjectSpendSection from "./details/ProjectSpendSection";
import { EditProjectModal } from "./ProjectModals/EditProjectModal";
import type { ProjectTeamInfo } from "./types";

const { Text } = Typography;
const { Content } = Layout;

interface ProjectDetailProps {
	projectId: string;
	onBack: () => void;
}

export function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
	const { data: project, isLoading } = useProjectDetails(projectId);
	const { data: teamData } = useTeam(project?.team_id ?? undefined);
	// teamInfoCall returns { team_id, team_info: {...}, keys, team_memberships }
	const teamInfo = ((teamData as unknown as { team_info?: ProjectTeamInfo })?.team_info ?? teamData) as
		| ProjectTeamInfo
		| undefined;
	const [isEditModalVisible, setIsEditModalVisible] = useState(false);

	const spend = project?.spend ?? 0;
	const maxBudget = project?.litellm_budget_table?.max_budget ?? null;

	const modelSpendData = useMemo(() => {
		const raw = (project?.model_spend ?? {}) as Record<string, number>;
		return Object.entries(raw)
			.map(([model, value]) => ({ model, spend: value }))
			.sort((a, b) => b.spend - a.spend);
	}, [project?.model_spend]);

	if (isLoading) {
		return (
			<ResourceDetailsDrawer open onClose={onBack} title="Project details" loading>
				<div>Loading project details...</div>
			</ResourceDetailsDrawer>
		);
	}

	if (!project) {
		return (
			<ResourceDetailsDrawer open onClose={onBack} title="Project details" error="Project not found">
				<div>Project not found</div>
			</ResourceDetailsDrawer>
		);
	}

	return (
		<ResourceDetailsDrawer
			open
			onClose={onBack}
			title={project.project_alias ?? project.project_id}
			subtitle={project.project_id}
			actions={
				<Button type="primary" icon={<EditIcon size={16} />} onClick={() => setIsEditModalVisible(true)}>
					Edit Project
				</Button>
			}
		>
			<Content style={{ padding: 0 }}>
				<Flex align="center" gap={8} style={{ marginBottom: 16 }}>
					<Tag color={project.blocked ? "red" : "green"}>{project.blocked ? "Blocked" : "Active"}</Tag>
					<Text type="secondary">
						ID: <Text copyable>{project.project_id}</Text>
					</Text>
				</Flex>

				<ProjectMetadataCard project={project} />
				<ProjectSpendSection spend={spend} maxBudget={maxBudget} modelSpendData={modelSpendData} />
				<ProjectResourcesSection teamInfo={teamInfo} hasTeam={Boolean(project.team_id)} />

				{/* Edit Modal */}
				<EditProjectModal
					isOpen={isEditModalVisible}
					project={project}
					onClose={() => setIsEditModalVisible(false)}
					onSuccess={onBack}
				/>
			</Content>
		</ResourceDetailsDrawer>
	);
}
