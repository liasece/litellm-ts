import { getProxyBaseUrl } from "@/components/networking";
import { Badge, Text } from "@tremor/react";
import { Modal } from "antd";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import type { ModelGroupInfo } from "../types";

interface ModelHubModelDetailsModalProps {
	model: ModelGroupInfo | null;
	open: boolean;
	onClose: () => void;
}

function formatCapabilityName(key: string) {
	return key
		.replace(/^supports_/, "")
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function formatCost(cost: number) {
	return `$${(cost * 1_000_000).toFixed(2)}`;
}

export default function ModelHubModelDetailsModal({
	model,
	open,
	onClose,
}: ModelHubModelDetailsModalProps) {
	const capabilities = model
		? Object.entries(model)
				.filter(([key, value]) => key.startsWith("supports_") && value === true)
				.map(([key]) => key)
		: [];
	const colors = ["green", "blue", "purple", "orange", "red", "yellow"] as const;

	return (
		<Modal
			title={model?.model_group || "Model Details"}
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
								<Text className="font-medium">Model Group:</Text>
								<Text>{model.model_group}</Text>
							</div>
							<div>
								<Text className="font-medium">Mode:</Text>
								<Text>{model.mode || "Not specified"}</Text>
							</div>
							<div>
								<Text className="font-medium">Providers:</Text>
								<div className="mt-1 flex flex-wrap gap-1">
									{model.providers.map((provider) => (
										<Badge key={provider} color="blue">
											{provider}
										</Badge>
									))}
								</div>
							</div>
						</div>
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
								<Text>
									{model.input_cost_per_token
										? formatCost(model.input_cost_per_token)
										: "Not specified"}
								</Text>
							</div>
							<div>
								<Text className="font-medium">Output Cost per 1M Tokens:</Text>
								<Text>
									{model.output_cost_per_token
										? formatCost(model.output_cost_per_token)
										: "Not specified"}
								</Text>
							</div>
						</div>
					</section>

					<section>
						<Text className="mb-4 text-lg font-semibold">Capabilities</Text>
						<div className="flex flex-wrap gap-2">
							{capabilities.length ? (
								capabilities.map((capability, index) => (
									<Badge key={capability} color={colors[index % colors.length]}>
										{formatCapabilityName(capability)}
									</Badge>
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
								{model.tpm && (
									<div>
										<Text className="font-medium">Tokens per Minute:</Text>
										<Text>{model.tpm.toLocaleString()}</Text>
									</div>
								)}
								{model.rpm && (
									<div>
										<Text className="font-medium">Requests per Minute:</Text>
										<Text>{model.rpm.toLocaleString()}</Text>
									</div>
								)}
							</div>
						</section>
					)}

					{model.supported_openai_params && (
						<section>
							<Text className="mb-4 text-lg font-semibold">Supported OpenAI Parameters</Text>
							<div className="flex flex-wrap gap-2">
								{model.supported_openai_params.map((parameter) => (
									<Badge key={parameter} color="green">
										{parameter}
									</Badge>
								))}
							</div>
						</section>
					)}

					<section>
						<Text className="mb-4 text-lg font-semibold">Usage Example</Text>
						<SyntaxHighlighter language="python" className="text-sm">
							{`import openai

client = openai.OpenAI(
    api_key="your_api_key",
    base_url="${getProxyBaseUrl()}"
)

response = client.chat.completions.create(
    model="${model.model_group}",
    messages=[{"role": "user", "content": "Hello, how are you?"}]
)

print(response.choices[0].message.content)`}
						</SyntaxHighlighter>
					</section>
				</div>
			)}
		</Modal>
	);
}

