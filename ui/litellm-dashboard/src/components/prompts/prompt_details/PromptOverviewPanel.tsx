import type { PromptSpec } from "@/components/networking";
import { Badge, Card, Grid, TabPanel, Text, Title } from "@tremor/react";

interface PromptOverviewPanelProps {
	prompt: PromptSpec;
	promptId: string;
	version: string;
}

function formatPromptDate(value?: string) {
	return value ? new Date(value).toLocaleString() : "-";
}

export default function PromptOverviewPanel({ prompt, promptId, version }: PromptOverviewPanelProps) {
	const promptType = prompt.prompt_info?.prompt_type || "-";
	const hasParameters = Object.keys(prompt.litellm_params ?? {}).length > 0;

	return (
		<TabPanel>
			<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
				<Card>
					<Text>Prompt ID</Text>
					<div className="mt-2">
						<Title className="font-mono text-sm">{promptId}</Title>
					</div>
				</Card>
				<Card>
					<Text>Version</Text>
					<div className="mt-2">
						<Title>{version}</Title>
						<Badge color="blue" className="mt-1">
							v{version}
						</Badge>
					</div>
				</Card>
				<Card>
					<Text>Prompt Type</Text>
					<div className="mt-2">
						<Title>{promptType}</Title>
						<Badge color="blue" className="mt-1">
							{promptType === "-" ? "Unknown" : promptType}
						</Badge>
					</div>
				</Card>
				<Card>
					<Text>Created At</Text>
					<div className="mt-2">
						<Title>{formatPromptDate(prompt.created_at)}</Title>
						<Text>Last Updated: {formatPromptDate(prompt.updated_at)}</Text>
					</div>
				</Card>
			</Grid>

			{hasParameters && (
				<Card className="mt-6">
					<Text className="font-medium">LiteLLM Parameters</Text>
					<div className="mt-2 rounded-md bg-gray-50 p-3">
						<pre className="whitespace-pre-wrap text-xs text-gray-800">
							{JSON.stringify(prompt.litellm_params, null, 2)}
						</pre>
					</div>
				</Card>
			)}
		</TabPanel>
	);
}
