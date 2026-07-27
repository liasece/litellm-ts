import { getProxyBaseUrl } from "@/components/networking";
import { Text, Title } from "@tremor/react";
import { Copy } from "lucide-react";

interface AIHubHeaderProps {
	isAdmin: boolean;
	onCopy: (value: string) => void;
}

export default function AIHubHeader({ isAdmin, onCopy }: AIHubHeaderProps) {
	const publicHubUrl = `${getProxyBaseUrl()}/ui/model_hub_table`;

	return (
		<div className="mb-6 flex items-center justify-between">
			<div className="flex flex-col items-start">
				<Title className="text-center">AI Hub</Title>
				<p className="text-sm text-gray-600">
					{isAdmin
						? "Make models, agents, and MCP servers public for developers to know what's available."
						: "A list of all public model names personally available to you."}
				</p>
			</div>
			<div className="flex items-center space-x-4">
				<Text>Model Hub URL:</Text>
				<div className="flex items-center rounded bg-gray-200 px-2 py-1">
					<Text className="mr-2">{publicHubUrl}</Text>
					<button
						type="button"
						onClick={() => onCopy(publicHubUrl)}
						className="rounded p-1 transition-colors hover:bg-gray-300"
						title="Copy URL"
					>
						<Copy size={16} className="text-gray-600" />
					</button>
				</div>
			</div>
		</div>
	);
}
