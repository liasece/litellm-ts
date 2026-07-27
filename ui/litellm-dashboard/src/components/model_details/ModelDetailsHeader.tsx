import { KeyIcon, RefreshIcon, TrashIcon } from "@heroicons/react/outline";
import { Button as TremorButton, Text, Title } from "@tremor/react";
import { Button } from "antd";
import { CheckIcon, CopyIcon } from "lucide-react";

interface ModelDetailsHeaderProps {
	displayName: string;
	modelId: string;
	modelIdCopied: boolean;
	canEditModel: boolean;
	isAdmin: boolean;
	onCopyModelId: () => void;
	onTestConnection: () => void;
	onReuseCredentials: () => void;
	onDeleteModel: () => void;
}

export default function ModelDetailsHeader({
	displayName,
	modelId,
	modelIdCopied,
	canEditModel,
	isAdmin,
	onCopyModelId,
	onTestConnection,
	onReuseCredentials,
	onDeleteModel,
}: ModelDetailsHeaderProps) {
	return (
		<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
			<div className="min-w-0">
				<Title>Public Model Name: {displayName}</Title>
				<div className="flex cursor-pointer items-center">
					<Text className="truncate font-mono text-gray-500">{modelId}</Text>
					<Button
						type="text"
						size="small"
						icon={modelIdCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
						onClick={onCopyModelId}
						className={`left-2 z-10 transition-all duration-200 ${
							modelIdCopied
								? "border-green-200 bg-green-50 text-green-600"
								: "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
						}`}
						aria-label="Copy model ID"
					/>
				</div>
			</div>
			<div className="flex shrink-0 flex-wrap justify-end gap-2">
				<TremorButton
					variant="secondary"
					icon={RefreshIcon}
					onClick={onTestConnection}
					className="flex items-center gap-2"
					data-testid="test-connection-button"
				>
					Test Connection
				</TremorButton>
				<TremorButton
					icon={KeyIcon}
					variant="secondary"
					onClick={onReuseCredentials}
					className="flex items-center"
					disabled={!isAdmin}
					data-testid="reuse-credentials-button"
				>
					Re-use Credentials
				</TremorButton>
				<TremorButton
					icon={TrashIcon}
					variant="secondary"
					onClick={onDeleteModel}
					className="flex items-center border-red-500 text-red-500 hover:text-red-700"
					disabled={!canEditModel}
					data-testid="delete-model-button"
				>
					Delete Model
				</TremorButton>
			</div>
		</div>
	);
}
