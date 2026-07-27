import { BarChart } from "@tremor/react";
import { Card, Col, Empty, Flex, Progress, Row, Typography } from "antd";
import { DollarSignIcon } from "lucide-react";

const { Text } = Typography;

interface ProjectSpendSectionProps {
	spend: number;
	maxBudget: number | null;
	modelSpendData: Array<{ model: string; spend: number }>;
}

export default function ProjectSpendSection({
	spend,
	maxBudget,
	modelSpendData,
}: ProjectSpendSectionProps) {
	const hasLimit = maxBudget != null && maxBudget > 0;
	const spendPercent = hasLimit ? Math.min((spend / maxBudget) * 100, 100) : 0;
	const spendColor = spendPercent >= 90 ? "#f5222d" : spendPercent >= 70 ? "#faad14" : "#52c41a";

	return (
		<Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
			<Col xs={24} lg={8}>
				<Card
					title={
						<Flex align="center" gap={8}>
							<DollarSignIcon size={16} />
							Budget
						</Flex>
					}
					style={{ height: "100%" }}
				>
					<Flex vertical gap={16}>
						<div>
							<Text strong style={{ fontSize: 28, lineHeight: 1 }}>
								${spend.toFixed(2)}
							</Text>
							<br />
							<Text type="secondary">
								{hasLimit && maxBudget != null ? `of $${maxBudget.toFixed(2)} budget` : "No budget limit"}
							</Text>
						</div>
						{hasLimit && (
							<div>
								<Progress percent={Math.round(spendPercent * 10) / 10} strokeColor={spendColor} showInfo={false} />
								<Text type="secondary" style={{ fontSize: 12 }}>
									{(Math.round(spendPercent * 10) / 10).toFixed(1)}% utilized
								</Text>
							</div>
						)}
					</Flex>
				</Card>
			</Col>
			<Col xs={24} lg={16}>
				<Card title="Spend by Model" style={{ height: "100%" }}>
					{modelSpendData.length > 0 ? (
						<BarChart
							data={modelSpendData}
							index="model"
							categories={["spend"]}
							colors={["cyan"]}
							layout="vertical"
							valueFormatter={(value) => `$${value.toFixed(4)}`}
							yAxisWidth={140}
							showLegend={false}
							style={{ height: Math.max(modelSpendData.length * 40, 120) }}
						/>
					) : (
						<Empty description="No model spend recorded yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
					)}
				</Card>
			</Col>
		</Row>
	);
}
