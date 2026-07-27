import type { ProjectResponse } from "@/app/(dashboard)/hooks/projects/useProjects";
import { Card, Descriptions, Row, Typography } from "antd";
import DefaultProxyAdminTag from "../../common_components/DefaultProxyAdminTag";

const { Text } = Typography;

export default function ProjectMetadataCard({ project }: { project: ProjectResponse }) {
	return (
		<Row style={{ marginBottom: 24 }}>
			<Card>
				<Descriptions title="Project Details" column={1}>
					<Descriptions.Item label="Description">{project.description || "—"}</Descriptions.Item>
					<Descriptions.Item label="Created">
						{new Date(project.created_at).toLocaleString()}
						{project.created_by && (
							<Text>
								&nbsp;by&nbsp;
								<DefaultProxyAdminTag userId={project.created_by} />
							</Text>
						)}
					</Descriptions.Item>
					<Descriptions.Item label="Last Updated">
						{new Date(project.updated_at).toLocaleString()}
						{project.updated_by && (
							<Text>
								&nbsp;by&nbsp;
								<DefaultProxyAdminTag userId={project.updated_by} />
							</Text>
						)}
					</Descriptions.Item>
				</Descriptions>
			</Card>
		</Row>
	);
}
