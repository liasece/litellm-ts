import { ExternalLinkIcon } from "@heroicons/react/outline";
import { Text } from "@tremor/react";
import { Modal, Tag, Tooltip } from "antd";
import { Copy } from "lucide-react";
import type { PublicAgentCard } from "../types";
import PublicCodeExample from "./PublicCodeExample";

interface PublicAgentDetailsModalProps {
	agent: PublicAgentCard | null;
	open: boolean;
	onClose: () => void;
	onCopy: (value: string) => void;
}

function resolverExample(url: string) {
	return `from a2a.client import A2ACardResolver, A2AClient
from a2a.types import AgentCard
from a2a.utils.constants import EXTENDED_AGENT_CARD_PATH

base_url = '${url}'
resolver = A2ACardResolver(httpx_client=httpx_client, base_url=base_url)
final_agent_card_to_use: AgentCard | None = await resolver.get_agent_card()

if final_agent_card_to_use.supports_authenticated_extended_card:
    auth_headers = {'Authorization': 'Bearer your-token'}
    final_agent_card_to_use = await resolver.get_agent_card(
        relative_card_path=EXTENDED_AGENT_CARD_PATH,
        http_kwargs={'headers': auth_headers},
    )`;
}

const CALL_EXAMPLE = `client = A2AClient(
    httpx_client=httpx_client,
    agent_card=final_agent_card_to_use,
)

send_message_payload = {
    'message': {
        'role': 'user',
        'parts': [{'kind': 'text', 'text': 'how much is 10 USD in INR?'}],
        'messageId': uuid4().hex,
    },
}
request = SendMessageRequest(
    id=str(uuid4()),
    params=MessageSendParams(**send_message_payload),
)
response = await client.send_message(request)`;

export default function PublicAgentDetailsModal({
	agent,
	open,
	onClose,
	onCopy,
}: PublicAgentDetailsModalProps) {
	const capabilities = agent
		? Object.entries(agent.capabilities ?? {})
				.filter(([, value]) => value === true)
				.map(([key]) => key)
		: [];

	return (
		<Modal
			title={
				<div className="flex items-center space-x-2">
					<span>{agent?.name || "Agent Details"}</span>
					{agent && (
						<Tooltip title="Copy agent name">
							<Copy
								onClick={() => onCopy(agent.name)}
								className="h-4 w-4 cursor-pointer text-gray-500 hover:text-blue-500"
							/>
						</Tooltip>
					)}
				</div>
			}
			width={1000}
			open={open}
			footer={null}
			onCancel={onClose}
			destroyOnHidden
		>
			{agent && (
				<div className="space-y-6">
					<section>
						<Text className="mb-4 text-lg font-semibold">Agent Overview</Text>
						<div className="mb-4 grid grid-cols-2 gap-4">
							<div>
								<Text className="font-medium">Name:</Text>
								<Text>{agent.name}</Text>
							</div>
							<div>
								<Text className="font-medium">Version:</Text>
								<Text>{agent.version}</Text>
							</div>
							<div className="col-span-2">
								<Text className="font-medium">Description:</Text>
								<Text>{agent.description}</Text>
							</div>
							{agent.url && (
								<a
									href={agent.url}
									target="_blank"
									rel="noopener noreferrer"
									className="break-all text-sm text-blue-600 hover:text-blue-800"
								>
									{agent.url}
								</a>
							)}
						</div>
					</section>

					{capabilities.length > 0 && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Capabilities</Text>
							<div className="flex flex-wrap gap-2">
								{capabilities.map((capability) => (
									<Tag key={capability} color="green" className="capitalize">
										{capability}
									</Tag>
								))}
							</div>
						</section>
					)}

					{agent.skills.length > 0 && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Skills</Text>
							<div className="space-y-4">
								{agent.skills.map((skill) => (
									<div key={skill.id} className="rounded-lg border border-gray-200 p-4">
										<Text className="text-base font-medium">{skill.name}</Text>
										<Text className="text-sm text-gray-600">{skill.description}</Text>
										<div className="mt-2 flex flex-wrap gap-1">
											{skill.tags?.map((tag) => (
												<Tag key={tag} color="purple" className="text-xs">
													{tag}
												</Tag>
											))}
										</div>
									</div>
								))}
							</div>
						</section>
					)}

					<section>
						<Text className="mb-4 text-lg font-semibold">Input/Output Modes</Text>
						<div className="grid grid-cols-2 gap-4">
							{[
								["Input Modes", agent.defaultInputModes],
								["Output Modes", agent.defaultOutputModes],
							].map(([label, modes]) => (
								<div key={String(label)}>
									<Text className="font-medium">{String(label)}:</Text>
									<div className="mt-1 flex flex-wrap gap-1">
										{Array.isArray(modes) &&
											modes.map((mode) => (
												<Tag key={mode} color="blue">
													{mode}
												</Tag>
											))}
									</div>
								</div>
							))}
						</div>
					</section>

					{agent.documentationUrl && (
						<a
							href={agent.documentationUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
						>
							<ExternalLinkIcon className="h-4 w-4" />
							<span>View Documentation</span>
						</a>
					)}

					<section className="space-y-4">
						<Text className="text-lg font-semibold">Usage Example (A2A Protocol)</Text>
						<PublicCodeExample
							title="Step 1: Retrieve Agent Card"
							code={resolverExample(agent.url)}
							onCopy={onCopy}
							compact
						/>
						<PublicCodeExample
							title="Step 2: Call the Agent"
							code={CALL_EXAMPLE}
							onCopy={onCopy}
							compact
						/>
					</section>
				</div>
			)}
		</Modal>
	);
}

