import { LoadingOutlined } from "@ant-design/icons";
import { Card, Col, Empty, Flex, Progress, Row, Spin, Tag, Typography } from "antd";
import { KeyIcon, UsersIcon } from "lucide-react";
import type { ProjectTeamInfo } from "../types";

const { Text } = Typography;

interface ProjectResourcesSectionProps {
	teamInfo: ProjectTeamInfo | undefined;
	hasTeam: boolean;
}

function ProjectTeamCard({ teamInfo, hasTeam }: ProjectResourcesSectionProps) {
	if (!teamInfo) {
		return hasTeam ? (
			<Flex justify="center" align="center" style={{ padding: 16 }}>
				<Spin indicator={<LoadingOutlined spin />} size="small" />
			</Flex>
		) : (
			<Empty description="No team assigned" image={Empty.PRESENTED_IMAGE_SIMPLE} />
		);
	}

	const teamBudget = teamInfo.max_budget ?? null;
	const teamSpend = teamInfo.spend ?? 0;
	const hasLimit = teamBudget != null && teamBudget > 0;
	const percent = hasLimit ? Math.min((teamSpend / teamBudget) * 100, 100) : 0;
	const color = percent >= 90 ? "#f5222d" : percent >= 70 ? "#faad14" : "#52c41a";

	return (
		<Flex vertical gap={12}>
			<div>
				<Text strong style={{ fontSize: 16 }}>
					{teamInfo.team_alias || teamInfo.team_id}
				</Text>
				<br />
				<Text type="secondary" style={{ fontSize: 12 }}>
					ID: <Text copyable>{teamInfo.team_id}</Text>
				</Text>
			</div>
			<div>
				<Text type="secondary" style={{ display: "block", marginBottom: 4, fontSize: 12 }}>
					Models
				</Text>
				{teamInfo.models?.length ? (
					<Flex wrap="wrap" gap={4} style={{ maxHeight: 60, overflow: "hidden" }}>
						{teamInfo.models.map((model) => (
							<Tag key={model} style={{ margin: 0 }}>
								{model}
							</Tag>
						))}
					</Flex>
				) : (
					<Text type="secondary">All models</Text>
				)}
			</div>
			<div>
				<Flex justify="space-between" align="center" style={{ marginBottom: 2 }}>
					<Text type="secondary" style={{ fontSize: 12 }}>
						Spend
					</Text>
					<Text style={{ fontSize: 12 }}>
						${teamSpend.toFixed(2)}
						<Text type="secondary" style={{ fontSize: 12 }}>
							{hasLimit && teamBudget != null ? ` / $${teamBudget.toFixed(2)}` : " (Unlimited)"}
						</Text>
					</Text>
				</Flex>
				{hasLimit && (
					<Progress percent={Math.round(percent * 10) / 10} strokeColor={color} size="small" showInfo={false} />
				)}
			</div>
			<Flex justify="space-between">
				<Text type="secondary" style={{ fontSize: 12 }}>
					Members
				</Text>
				<Text style={{ fontSize: 12 }}>{teamInfo.members_with_roles?.length ?? 0}</Text>
			</Flex>
		</Flex>
	);
}

export default function ProjectResourcesSection(props: ProjectResourcesSectionProps) {
	return (
		<Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
			<Col xs={24} lg={12}>
				<Card
					title={
						<Flex align="center" gap={8}>
							<KeyIcon size={16} />
							Keys
						</Flex>
					}
					style={{ height: "100%" }}
				>
					<Empty description="No keys to display" image={Empty.PRESENTED_IMAGE_SIMPLE} />
				</Card>
			</Col>
			<Col xs={24} lg={12}>
				<Card
					title={
						<Flex align="center" gap={8}>
							<UsersIcon size={16} />
							Team
						</Flex>
					}
					style={{ height: "100%" }}
				>
					<ProjectTeamCard {...props} />
				</Card>
			</Col>
		</Row>
	);
}
