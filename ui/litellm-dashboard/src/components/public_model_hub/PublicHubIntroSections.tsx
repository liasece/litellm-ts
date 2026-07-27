import { ExternalLinkIcon } from "@heroicons/react/outline";
import { Card, Text, Title } from "@tremor/react";
import type { UsefulLinks } from "./types";

interface PublicHubIntroSectionsProps {
	embedded: boolean;
	description: string | null;
	version: string;
	usefulLinks: UsefulLinks;
	serviceStatus: string;
}

export default function PublicHubIntroSections({
	embedded,
	description,
	version,
	usefulLinks,
	serviceStatus,
}: PublicHubIntroSectionsProps) {
	const sortedLinks = Object.entries(usefulLinks)
		.map(([title, value]) => ({
			title,
			url: typeof value === "string" ? value : value.url,
			index: typeof value === "string" ? 0 : value.index ?? 0,
		}))
		.sort((a, b) => a.index - b.index);

	return (
		<>
			{embedded ? (
				<div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
					<p className="text-sm text-gray-700">
						These are models, agents, and MCP servers your proxy admin has indicated are available in your company.
					</p>
				</div>
			) : (
				<Card className="mb-10 rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
					<Title className="mb-6 text-2xl font-semibold text-gray-900">About</Title>
					<p className="mb-6 text-base leading-relaxed text-gray-700">
						{description || "Proxy Server to call 100+ LLMs in the OpenAI format."}
					</p>
					<div className="flex items-center space-x-3 text-sm text-gray-600">
						<span className="flex items-center">
							<span className="mr-2 h-4 w-4">🔧</span>
							Built with litellm: v{version}
						</span>
					</div>
				</Card>
			)}

			{sortedLinks.length > 0 && (
				<Card className="mb-10 rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
					<Title className="mb-6 text-2xl font-semibold text-gray-900">Useful Links</Title>
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
						{sortedLinks.map(({ title, url }) => (
							<button
								type="button"
								key={title}
								onClick={() => window.open(url, "_blank")}
								className="flex items-center space-x-3 rounded-lg border border-gray-200 p-3 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800"
							>
								<ExternalLinkIcon className="h-4 w-4" />
								<Text className="text-sm font-medium">{title}</Text>
							</button>
						))}
					</div>
				</Card>
			)}

			{!embedded && (
				<Card className="mb-10 rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
					<Title className="mb-6 text-2xl font-semibold text-gray-900">Health and Endpoint Status</Title>
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
						<Text className="text-sm font-medium text-green-600">Service status: {serviceStatus}</Text>
					</div>
				</Card>
			)}
		</>
	);
}
