import { Button } from "antd";
import { Text } from "@tremor/react";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { PromptCopyHandler } from "./types";

interface PromptIdentifierBarProps {
	promptId: string;
	copied: boolean;
	onCopy: PromptCopyHandler;
}

export default function PromptIdentifierBar({ promptId, copied, onCopy }: PromptIdentifierBarProps) {
	return (
		<div className="mb-4 flex cursor-pointer items-center">
			<Text className="font-mono text-gray-500">{promptId}</Text>
			<Button
				type="text"
				size="small"
				aria-label="Copy prompt ID"
				icon={copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
				onClick={() => onCopy(promptId, "prompt-id")}
			/>
		</div>
	);
}
