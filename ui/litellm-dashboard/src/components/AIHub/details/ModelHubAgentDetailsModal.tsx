import type { AgentHubData } from "@/components/AIHub/AgentHubTableColumns";
import { CopyOutlined } from "@ant-design/icons";
import { Badge, Text } from "@tremor/react";
import { Modal } from "antd";

interface ModelHubAgentDetailsModalProps {
	agent: AgentHubData | null;
	open: boolean;
	onClose: () => void;
	onCopy: (value: string) => void;
}

export default function ModelHubAgentDetailsModal({ agent, open, onClose, onCopy }: ModelHubAgentDetailsModalProps) {
	const capabilities = agent
		? Object.entries(agent.capabilities ?? {})
				.filter(([, value]) => value === true)
				.map(([key]) => key)
		: [];

	return (
		<Modal
			title={agent?.name || "Agent Details"}
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
								<Badge color="blue">v{agent.version}</Badge>
							</div>
							<div>
								<Text className="font-medium">Protocol Version:</Text>
								<Text>{agent.protocolVersion}</Text>
							</div>
							<div>
								<Text className="font-medium">URL:</Text>
								<div className="flex items-center space-x-2">
									<Text className="truncate">{agent.url}</Text>
									<CopyOutlined
										onClick={() => onCopy(agent.url)}
										className="cursor-pointer text-gray-500 hover:text-blue-500"
									/>
								</div>
							</div>
						</div>
						<Text className="font-medium">Description:</Text>
						<Text className="mt-1">{agent.description}</Text>
					</section>

					{capabilities.length > 0 && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Capabilities</Text>
							<div className="flex flex-wrap gap-2">
								{capabilities.map((capability) => (
									<Badge key={capability} color="green">
										{capability}
									</Badge>
								))}
							</div>
						</section>
					)}

					<section>
						<Text className="mb-4 text-lg font-semibold">Input/Output Modes</Text>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Text className="font-medium">Input Modes:</Text>
								<div className="mt-1 flex flex-wrap gap-1">
									{agent.defaultInputModes?.length ? (
										agent.defaultInputModes.map((mode) => (
											<Badge key={mode} color="blue">
												{mode}
											</Badge>
										))
									) : (
										<Text>Not specified</Text>
									)}
								</div>
							</div>
							<div>
								<Text className="font-medium">Output Modes:</Text>
								<div className="mt-1 flex flex-wrap gap-1">
									{agent.defaultOutputModes?.length ? (
										agent.defaultOutputModes.map((mode) => (
											<Badge key={mode} color="purple">
												{mode}
											</Badge>
										))
									) : (
										<Text>Not specified</Text>
									)}
								</div>
							</div>
						</div>
					</section>

					{agent.skills && agent.skills.length > 0 && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Skills</Text>
							<div className="space-y-4">
								{agent.skills.map((skill) => (
									<div key={skill.id} className="rounded border border-gray-200 p-4">
										<div className="mb-2 flex items-start justify-between">
											<div>
												<Text className="text-base font-medium">{skill.name}</Text>
												<Text className="text-xs text-gray-500">ID: {skill.id}</Text>
											</div>
											<div className="flex flex-wrap gap-1">
												{skill.tags?.map((tag) => (
													<Badge key={tag} color="purple" size="xs">
														{tag}
													</Badge>
												))}
											</div>
										</div>
										<Text className="mb-2 text-sm">{skill.description}</Text>
										{skill.examples && skill.examples.length > 0 && (
											<div>
												<Text className="text-xs font-medium text-gray-700">Examples:</Text>
												<div className="mt-1 flex flex-wrap gap-1">
													{skill.examples.map((example) => (
														<Badge key={example} color="gray" size="xs">
															{example}
														</Badge>
													))}
												</div>
											</div>
										)}
									</div>
								))}
							</div>
						</section>
					)}

					{agent.supportsAuthenticatedExtendedCard && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Additional Features</Text>
							<Badge color="green">Supports Authenticated Extended Card</Badge>
						</section>
					)}
				</div>
			)}
		</Modal>
	);
}
