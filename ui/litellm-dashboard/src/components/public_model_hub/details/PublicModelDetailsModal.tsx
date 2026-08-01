import ProviderLogo from "@/components/common_components/ProviderLogo";
import { generateCodeSnippet } from "@/components/playground/chat_ui/CodeSnippets";
import { getEndpointType } from "@/components/playground/chat_ui/mode_endpoint_mapping";
import type { MessageType } from "@/components/playground/chat_ui/types";
import { getModelLogoAndName } from "@/components/provider_info_helpers";
import { Text } from "@tremor/react";
import { Modal, Tag, Tooltip } from "antd";
import { Copy, Info } from "lucide-react";
import { formatCapabilityName } from "../filters";
import type { PublicModelInfo } from "../types";
import PublicCodeExample from "./PublicCodeExample";

interface PublicModelDetailsModalProps {
	model: PublicModelInfo | null;
	open: boolean;
	onClose: () => void;
	onCopy: (value: string) => void;
}

function formatCost(cost: number) {
	return `$${(cost * 1_000_000).toFixed(4)}`;
}

export default function PublicModelDetailsModal({ model, open, onClose, onCopy }: PublicModelDetailsModalProps) {
	const capabilities = model
		? Object.entries(model)
				.filter(([key, value]) => key.startsWith("supports_") && value === true)
				.map(([key]) => key)
		: [];
	const code = model
		? generateCodeSnippet({
				apiKeySource: "custom",
				accessToken: null,
				apiKey: "your_api_key",
				inputMessage: "Hello, how are you?",
				chatHistory: [{ role: "user", content: "Hello, how are you?", isImage: false } as MessageType],
				selectedTags: [],
				selectedVectorStores: [],
				selectedGuardrails: [],
				selectedPolicies: [],
				selectedMCPServers: [],
				endpointType: getEndpointType(model.mode || "chat"),
				selectedModel: model.model_group,
				selectedSdk: "openai",
			})
		: "";
	const colors = ["green", "blue", "purple", "orange", "red", "yellow"];

	return (
		<Modal
			title={
				<div className="flex items-center space-x-2">
					<span>{model?.model_group || "Model Details"}</span>
					{model && (
						<Tooltip title="Copy model name">
							<Copy
								onClick={() => onCopy(model.model_group)}
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
			{model && (
				<div className="space-y-6">
					<section>
						<Text className="mb-4 text-lg font-semibold">Model Overview</Text>
						<div className="mb-4 grid grid-cols-2 gap-4">
							<div>
								<Text className="font-medium">Model Name:</Text>
								<Text>{model.model_group}</Text>
							</div>
							<div>
								<Text className="font-medium">Mode:</Text>
								<Text>{model.mode || "Not specified"}</Text>
							</div>
							<div>
								<Text className="font-medium">Providers:</Text>
								<div className="mt-1 flex flex-wrap gap-1">
									{(model.providers ?? []).map((provider) => {
										const { logo } = getModelLogoAndName(provider, model.model_group);
										return (
											<Tag key={provider} color="blue">
												<span className="flex items-center space-x-1">
													<ProviderLogo
														provider={provider}
														logo={logo}
														className="h-3 w-3 flex-shrink-0 object-contain"
														fallbackClassName="hidden"
													/>
													<span className="capitalize">{provider}</span>
												</span>
											</Tag>
										);
									})}
								</div>
							</div>
						</div>
						{model.model_group.includes("*") && (
							<div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
								<div className="flex items-start space-x-2">
									<Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
									<div>
										<Text className="mb-2 font-medium text-blue-900">Wildcard Routing</Text>
										<Text className="text-sm text-blue-800">
											Replace <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">*</code> with any matching
											value, for example{" "}
											<code className="rounded bg-blue-100 px-1 py-0.5 text-xs">
												{model.model_group.replace("*", "my-custom-value")}
											</code>
											.
										</Text>
									</div>
								</div>
							</div>
						)}
					</section>

					<section>
						<Text className="mb-4 text-lg font-semibold">Token & Cost Information</Text>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<Text className="font-medium">Max Input Tokens:</Text>
								<Text>{model.max_input_tokens?.toLocaleString() || "Not specified"}</Text>
							</div>
							<div>
								<Text className="font-medium">Max Output Tokens:</Text>
								<Text>{model.max_output_tokens?.toLocaleString() || "Not specified"}</Text>
							</div>
							<div>
								<Text className="font-medium">Input Cost per 1M Tokens:</Text>
								<Text>{model.input_cost_per_token ? formatCost(model.input_cost_per_token) : "Not specified"}</Text>
							</div>
							<div>
								<Text className="font-medium">Output Cost per 1M Tokens:</Text>
								<Text>{model.output_cost_per_token ? formatCost(model.output_cost_per_token) : "Not specified"}</Text>
							</div>
						</div>
					</section>

					<section>
						<Text className="mb-4 text-lg font-semibold">Capabilities</Text>
						<div className="flex flex-wrap gap-2">
							{capabilities.length ? (
								capabilities.map((capability, index) => (
									<Tag key={capability} color={colors[index % colors.length]}>
										{formatCapabilityName(capability)}
									</Tag>
								))
							) : (
								<Text className="text-gray-500">No special capabilities listed</Text>
							)}
						</div>
					</section>

					{(model.tpm || model.rpm) && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Rate Limits</Text>
							<div className="grid grid-cols-2 gap-4">
								{model.tpm && <Text>Tokens per Minute: {model.tpm.toLocaleString()}</Text>}
								{model.rpm && <Text>Requests per Minute: {model.rpm.toLocaleString()}</Text>}
							</div>
						</section>
					)}

					{model.supported_openai_params && model.supported_openai_params.length > 0 && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Supported OpenAI Parameters</Text>
							<div className="flex flex-wrap gap-2">
								{model.supported_openai_params.map((parameter) => (
									<Tag key={parameter} color="green">
										{parameter}
									</Tag>
								))}
							</div>
						</section>
					)}
					<PublicCodeExample title="Usage Example" code={code} onCopy={onCopy} />
				</div>
			)}
		</Modal>
	);
}
