import { ArrowLeftIcon } from "@heroicons/react/outline";
import { Button, Text, Title } from "@tremor/react";
import { Typography } from "antd";

interface OrganizationHeaderProps {
	name: string;
	organizationId: string;
	onBack: () => void;
}

export default function OrganizationHeader({
	name,
	organizationId,
	onBack,
}: OrganizationHeaderProps) {
	return (
		<div className="mb-6 flex items-center justify-between">
			<div>
				<Button icon={ArrowLeftIcon} onClick={onBack} variant="light" className="mb-4">
					Back to Organizations
				</Button>
				<Title>{name}</Title>
				<Text className="font-mono text-gray-500">
					<Typography.Text
						copyable={{ text: organizationId, tooltips: ["Copy organization ID", "Copied!"] }}
					>
						{organizationId}
					</Typography.Text>
				</Text>
			</div>
		</div>
	);
}

