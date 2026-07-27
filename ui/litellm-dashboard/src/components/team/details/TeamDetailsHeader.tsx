import { ArrowLeftIcon } from "@heroicons/react/outline";
import { Text, Title } from "@tremor/react";
import { Button } from "antd";
import { CheckIcon, CopyIcon } from "lucide-react";

interface TeamDetailsHeaderProps {
	teamAlias: string;
	teamId: string;
	teamIdCopied: boolean;
	onBack: () => void;
	onCopyTeamId: () => void;
}

export default function TeamDetailsHeader({
	teamAlias,
	teamId,
	teamIdCopied,
	onBack,
	onCopyTeamId,
}: TeamDetailsHeaderProps) {
	return (
		<div className="mb-6">
			<Button type="text" icon={<ArrowLeftIcon className="h-4 w-4" />} onClick={onBack} className="mb-4">
				Back to Teams
			</Button>
			<Title>{teamAlias}</Title>
			<div className="flex items-center">
				<Text className="truncate font-mono text-gray-500">{teamId}</Text>
				<Button
					type="text"
					size="small"
					icon={teamIdCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
					onClick={onCopyTeamId}
					className={`left-2 z-10 transition-all duration-200 ${
						teamIdCopied
							? "border-green-200 bg-green-50 text-green-600"
							: "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
					}`}
					aria-label="Copy team ID"
				/>
			</div>
		</div>
	);
}
