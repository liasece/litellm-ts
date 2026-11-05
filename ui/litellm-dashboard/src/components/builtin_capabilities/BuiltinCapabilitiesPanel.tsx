"use client";

import { Button, Card, Text, Title } from "@tremor/react";
import { Alert, Form, InputNumber, Spin, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import NotificationsManager from "../molecules/notifications_manager";
import {
	builtinCapabilitiesCall,
	type BuiltinCapabilitiesResponse,
	credentialListCall,
	updateBuiltinCapabilitiesCall,
} from "../networking";
import ExecutorChainEditor from "./ExecutorChainEditor";

/** 与后端 MAX_BUILTIN_CAPABILITY_ITERATIONS 对齐的私有轮次上限。 */
const MAX_PRIVATE_TURNS = 20;

/** 把候选模型列表投影成下拉选项。 */
function toModelOptions(
	candidates: BuiltinCapabilitiesResponse["available_models"] | undefined,
): Array<{ label: string; value: string }> {
	return (candidates ?? []).map((candidate) => ({ label: candidate.model_name, value: candidate.model_name }));
}

export default function BuiltinCapabilitiesPanel() {
	const [form] = Form.useForm();
	const [data, setData] = useState<BuiltinCapabilitiesResponse | null>(null);
	const [credentialOptions, setCredentialOptions] = useState<Array<{ label: string; value: string }>>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const imageGenerationEnabled = Form.useWatch(["image_generation", "enabled"], form);
	const webEnabled = Form.useWatch(["web", "enabled"], form);

	useEffect(() => {
		builtinCapabilitiesCall()
			.then((response) => {
				setData(response);
				form.setFieldsValue(response.capabilities);
			})
			.catch(() => NotificationsManager.fromBackend("Failed to load built-in capabilities"))
			.finally(() => setLoading(false));
		// 直连执行者只按名称引用 Credential；这里只取名称用于下拉，从不读取或展示密钥。
		credentialListCall("")
			.then((response) =>
				setCredentialOptions(
					(response.credentials ?? []).map((credential) => ({
						label: credential.credential_name,
						value: credential.credential_name,
					})),
				),
			)
			.catch(() => setCredentialOptions([]));
	}, [form]);

	const modelOptions = useMemo(() => toModelOptions(data?.available_models), [data]);
	const imageGenerationModelOptions = useMemo(
		() => toModelOptions(data?.image_generation_available_models),
		[data],
	);
	const webModelOptions = useMemo(() => toModelOptions(data?.web_available_models), [data]);

	const save = async (capabilities: BuiltinCapabilitiesResponse["capabilities"]) => {
		try {
			setSaving(true);
			const response = await updateBuiltinCapabilitiesCall(capabilities);
			setData(response);
			form.setFieldsValue(response.capabilities);
			NotificationsManager.success("Built-in capabilities updated");
		} catch (error) {
			NotificationsManager.fromBackend(
				error instanceof Error ? error.message : "Failed to update built-in capabilities",
			);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="flex min-h-64 items-center justify-center">
				<Spin />
			</div>
		);
	}

	return (
		<div className="w-full p-8">
			<div className="mb-6">
				<Title>Built-in Capabilities</Title>
				<Text className="mt-1 text-gray-500">
					Manage private capabilities executed by LiteLLM. Models opt in separately from their model settings.
				</Text>
			</div>

			<Form form={form} layout="vertical" onFinish={save}>
				<div className="max-w-4xl space-y-6">
					<Card>
						<div className="mb-5 flex items-start justify-between gap-6">
							<div>
								<Title>Image Generation &amp; Editing</Title>
								<Text className="mt-1 text-gray-500">
									Lets selected models privately create new images or edit attached images through a dedicated image model.
								</Text>
							</div>
							<Form.Item name={["image_generation", "enabled"]} valuePropName="checked" className="mb-0">
								<Switch checkedChildren="On" unCheckedChildren="Off" />
							</Form.Item>
						</div>

						<Alert
							className="mb-5"
							type="info"
							showIcon
							message="The main model writes the production prompt and chooses create or edit. LiteLLM keeps image bytes private and attaches generated images to Chat and Responses outputs."
						/>

						<div className="mb-5">
							<Text className="mb-2 block text-sm font-medium">Execution chain</Text>
							<Text className="mb-3 block text-xs text-gray-500">
								Tried in order. The first executor that succeeds answers the tool call.
							</Text>
							<Form.Item
								name={["image_generation", "executors"]}
								rules={[
									{
										validator: async (_, value: unknown[] | undefined) => {
											if (imageGenerationEnabled && (value ?? []).length === 0) {
												throw new Error("Add at least one executor");
											}
										},
									},
								]}
							>
								<ExecutorChainEditor
									modelOptions={imageGenerationModelOptions}
									credentialOptions={credentialOptions}
									allowDeepSeekTools={false}
									emptyHint="No executor configured. Add a model executor to run this capability."
								/>
							</Form.Item>
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<Form.Item name={["image_generation", "max_iterations"]} label="Maximum private turns" rules={[{ required: true }]}>
								<InputNumber min={1} max={MAX_PRIVATE_TURNS} className="w-full" />
							</Form.Item>

							<Form.Item name={["image_generation", "max_output_tokens"]} label="Worker output token limit">
								<InputNumber min={128} step={128} className="w-full" />
							</Form.Item>

							<Form.Item
								name={["image_generation", "always_inject"]}
								label="Allow creation without source image"
								valuePropName="checked"
								extra="Keep enabled to allow creating an image even when no source image is attached."
							>
								<Switch checkedChildren="On" unCheckedChildren="Off" />
							</Form.Item>
						</div>
					</Card>

					<Card>
						<div className="mb-5 flex items-start justify-between gap-6">
							<div>
								<Title>Vision</Title>
								<Text className="mt-1 text-gray-500">
									Lets selected text-only models privately delegate image inspection to a vision-capable model.
								</Text>
							</div>
							<Form.Item name={["vision", "enabled"]} valuePropName="checked" className="mb-0">
								<Switch checkedChildren="On" unCheckedChildren="Off" />
							</Form.Item>
						</div>

						<Alert
							className="mb-5"
							type="info"
							showIcon
							message="Injection requires this global switch and Vision on the requested model. The setting below controls whether an image must already be present."
						/>

						<Form.Item
							name={["vision", "always_inject"]}
							label="Always inject into context"
							valuePropName="checked"
							extra="Inject the private tool and instructions even when the current request has no image yet. Requests without image references are instructed not to call it."
						>
							<Switch aria-label="Always inject into context" checkedChildren="On" unCheckedChildren="Off" />
						</Form.Item>

						<div className="mb-5">
							<Text className="mb-2 block text-sm font-medium">Execution chain</Text>
							<Text className="mb-3 block text-xs text-gray-500">
								Tried in order. The first executor that succeeds answers the tool call.
							</Text>
							<Form.Item name={["vision", "executors"]}>
								<ExecutorChainEditor
									modelOptions={modelOptions}
									credentialOptions={credentialOptions}
									allowDeepSeekTools={false}
									emptyHint="No executor configured. Add a vision-capable model executor."
								/>
							</Form.Item>
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<Form.Item name={["vision", "max_iterations"]} label="Maximum private turns" rules={[{ required: true }]}>
								<InputNumber min={1} max={MAX_PRIVATE_TURNS} className="w-full" />
							</Form.Item>

							<Form.Item
								name={["vision", "max_output_tokens"]}
								label="Worker output token limit"
								rules={[{ required: true }]}
							>
								<InputNumber min={128} step={128} className="w-full" />
							</Form.Item>
						</div>
					</Card>

					<Card>
						<div className="mb-5 flex items-start justify-between gap-6">
							<div>
								<Title>Web Search &amp; Fetch</Title>
								<Text className="mt-1 text-gray-500">
									Lets selected models privately search the live web and retrieve webpages.
								</Text>
							</div>
							<Form.Item name={["web", "enabled"]} valuePropName="checked" className="mb-0">
								<Switch checkedChildren="On" unCheckedChildren="Off" />
							</Form.Item>
						</div>

						<Alert
							className="mb-5"
							type="info"
							showIcon
							message="A model executor performs the request through its upstream hosted search. A DeepSeek Search & Fetch executor calls the provider's tools endpoint directly: no worker-model tokens, billed per successful request, and the API key stays in the referenced credential."
						/>

						<div className="mb-5">
							<Text className="mb-2 block text-sm font-medium">Execution chain</Text>
							<Text className="mb-3 block text-xs text-gray-500">
								Tried in order. Model executors cover hosted search; DeepSeek Search &amp; Fetch bypasses the model
								entirely.
							</Text>
							<Form.Item
								name={["web", "executors"]}
								rules={[
									{
										validator: async (_, value: unknown[] | undefined) => {
											if (webEnabled && (value ?? []).length === 0) {
												throw new Error("Add at least one executor");
											}
										},
									},
								]}
							>
								<ExecutorChainEditor
									modelOptions={webModelOptions}
									credentialOptions={credentialOptions}
									allowDeepSeekTools={true}
									emptyHint="No executor configured. Add a model or DeepSeek Search & Fetch executor."
								/>
							</Form.Item>
						</div>

						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<Form.Item name={["web", "max_iterations"]} label="Maximum private turns" rules={[{ required: true }]}>
								<InputNumber min={1} max={MAX_PRIVATE_TURNS} className="w-full" />
							</Form.Item>

							<Form.Item
								name={["web", "max_output_tokens"]}
								label="Worker output token limit"
								rules={[{ required: true }]}
							>
								<InputNumber min={128} step={128} className="w-full" />
							</Form.Item>
						</div>
					</Card>

					<div className="flex justify-end">
						<Button loading={saving} type="submit">
							Save Changes
						</Button>
					</div>
				</div>
			</Form>
		</div>
	);
}
