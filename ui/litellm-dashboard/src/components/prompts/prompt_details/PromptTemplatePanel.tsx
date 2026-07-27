import type { PromptTemplateBase } from "@/components/networking";
import { Card, TabPanel, Text, Title } from "@tremor/react";
import { Button } from "antd";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { PromptCopyHandler } from "./types";

interface PromptTemplatePanelProps {
	template: PromptTemplateBase;
	copied: boolean;
	onCopy: PromptCopyHandler;
}

export default function PromptTemplatePanel({
	template,
	copied,
	onCopy,
}: PromptTemplatePanelProps) {
	const hasMetadata = Boolean(
		template.metadata && Object.keys(template.metadata).length > 0,
	);

	return (
		<TabPanel>
			<Card>
				<div className="mb-4 flex items-center justify-between">
					<Title>Prompt Template</Title>
					<Button
						type="text"
						size="small"
						icon={copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
						onClick={() => onCopy(template.content, "prompt-content")}
						className={`transition-all duration-200 ${
							copied
								? "border-green-200 bg-green-50 text-green-600"
								: "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
						}`}
					>
						{copied ? "Copied!" : "Copy Content"}
					</Button>
				</div>

				<div className="space-y-4">
					<div>
						<Text className="font-medium">Template ID</Text>
						<div className="rounded bg-gray-50 p-2 font-mono text-sm">
							{template.litellm_prompt_id}
						</div>
					</div>
					<div>
						<Text className="font-medium">Content</Text>
						<div className="mt-2 max-h-96 overflow-auto rounded-md border bg-gray-50 p-4">
							<pre className="whitespace-pre-wrap text-sm text-gray-800">
								{template.content}
							</pre>
						</div>
					</div>
					{hasMetadata && (
						<div>
							<Text className="font-medium">Template Metadata</Text>
							<div className="mt-2 rounded-md border bg-gray-50 p-3">
								<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-gray-800">
									{JSON.stringify(template.metadata, null, 2)}
								</pre>
							</div>
						</div>
					)}
				</div>
			</Card>
		</TabPanel>
	);
}

