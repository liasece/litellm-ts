import { Card, TabPanel, Title } from "@tremor/react";
import { Button } from "antd";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { PromptCopyHandler } from "./types";

interface PromptRawJsonPanelProps {
	response: unknown;
	copied: boolean;
	onCopy: PromptCopyHandler;
}

export default function PromptRawJsonPanel({ response, copied, onCopy }: PromptRawJsonPanelProps) {
	const formattedResponse = JSON.stringify(response, null, 2);

	return (
		<TabPanel>
			<Card>
				<div className="mb-4 flex items-center justify-between">
					<Title>Raw API Response</Title>
					<Button
						type="text"
						size="small"
						icon={copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
						onClick={() => onCopy(formattedResponse, "raw-json")}
						className={`transition-all duration-200 ${
							copied
								? "border-green-200 bg-green-50 text-green-600"
								: "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
						}`}
					>
						{copied ? "Copied!" : "Copy JSON"}
					</Button>
				</div>
				<div className="overflow-auto rounded-md border bg-gray-50 p-4">
					<pre className="whitespace-pre-wrap text-xs text-gray-800">{formattedResponse}</pre>
				</div>
			</Card>
		</TabPanel>
	);
}
