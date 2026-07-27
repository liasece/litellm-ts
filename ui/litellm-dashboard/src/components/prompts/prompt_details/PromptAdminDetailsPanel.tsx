import type { PromptSpec } from "@/components/networking";
import { Card, TabPanel, Text, Title } from "@tremor/react";

interface PromptAdminDetailsPanelProps {
	prompt: PromptSpec;
	promptId: string;
}

function formatPromptDate(value?: string) {
	return value ? new Date(value).toLocaleString() : "-";
}

export default function PromptAdminDetailsPanel({ prompt, promptId }: PromptAdminDetailsPanelProps) {
	return (
		<TabPanel>
			<Card>
				<Title className="mb-4">Prompt Details</Title>
				<div className="space-y-4">
					<div>
						<Text className="font-medium">Prompt ID</Text>
						<div className="rounded bg-gray-50 p-2 font-mono text-sm">{promptId}</div>
					</div>
					<div>
						<Text className="font-medium">Prompt Type</Text>
						<div>{prompt.prompt_info?.prompt_type || "-"}</div>
					</div>
					<div>
						<Text className="font-medium">Created At</Text>
						<div>{formatPromptDate(prompt.created_at)}</div>
					</div>
					<div>
						<Text className="font-medium">Last Updated</Text>
						<div>{formatPromptDate(prompt.updated_at)}</div>
					</div>
					<div>
						<Text className="font-medium">LiteLLM Parameters</Text>
						<div className="mt-2 rounded-md border bg-gray-50 p-3">
							<pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-gray-800">
								{JSON.stringify(prompt.litellm_params, null, 2)}
							</pre>
						</div>
					</div>
					<div>
						<Text className="font-medium">Prompt Info</Text>
						<div className="mt-2 rounded-md border bg-gray-50 p-3">
							<pre className="whitespace-pre-wrap text-xs text-gray-800">
								{JSON.stringify(prompt.prompt_info, null, 2)}
							</pre>
						</div>
					</div>
				</div>
			</Card>
		</TabPanel>
	);
}
