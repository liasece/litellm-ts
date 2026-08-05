"use client";

import { Button, Card, Text, Title } from "@tremor/react";
import { Alert, Form, InputNumber, Select, Spin, Switch } from "antd";
import { useEffect, useMemo, useState } from "react";
import NotificationsManager from "../molecules/notifications_manager";
import {
	builtinCapabilitiesCall,
	type BuiltinCapabilitiesResponse,
	updateBuiltinCapabilitiesCall,
} from "../networking";

export default function BuiltinCapabilitiesPanel() {
	const [form] = Form.useForm();
	const [data, setData] = useState<BuiltinCapabilitiesResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const enabled = Form.useWatch(["vision", "enabled"], form);
	const handlerModel = Form.useWatch(["vision", "handler_model"], form);

	useEffect(() => {
		builtinCapabilitiesCall()
			.then((response) => {
				setData(response);
				form.setFieldsValue(response.capabilities);
			})
			.catch(() => NotificationsManager.fromBackend("Failed to load built-in capabilities"))
			.finally(() => setLoading(false));
	}, [form]);

	const modelOptions = useMemo(
		() =>
			(data?.available_models ?? [])
				.filter((candidate) => candidate.mode === "chat" || candidate.mode === "responses")
				.map((candidate) => ({ label: candidate.model_name, value: candidate.model_name })),
		[data],
	);
	const fallbackOptions = modelOptions.filter((option) => option.value !== handlerModel);

	const save = async (capabilities: BuiltinCapabilitiesResponse["capabilities"]) => {
		try {
			setSaving(true);
			const response = await updateBuiltinCapabilitiesCall(capabilities);
			setData(response);
			form.setFieldsValue(response.capabilities);
			NotificationsManager.success("Built-in capabilities updated");
		} catch (error) {
			NotificationsManager.fromBackend(error instanceof Error ? error.message : "Failed to update built-in capabilities");
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
				<Card className="max-w-4xl">
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

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<Form.Item
							name={["vision", "handler_model"]}
							label="Execution model"
							rules={[{ required: enabled, message: "Select a vision execution model" }]}
						>
							<Select
								showSearch
								allowClear
								optionFilterProp="label"
								options={modelOptions}
								placeholder="Select a vision-capable model"
							/>
						</Form.Item>

						<Form.Item name={["vision", "fallback_models"]} label="Capability fallback models">
							<Select
								mode="multiple"
								showSearch
								allowClear
								optionFilterProp="label"
								options={fallbackOptions}
								placeholder="Tried in order after the execution model"
							/>
						</Form.Item>

						<Form.Item
							name={["vision", "max_iterations"]}
							label="Maximum private turns"
							rules={[{ required: true }]}
						>
							<InputNumber min={1} max={8} className="w-full" />
						</Form.Item>

						<Form.Item
							name={["vision", "max_output_tokens"]}
							label="Worker output token limit"
							rules={[{ required: true }]}
						>
							<InputNumber min={128} max={16384} step={128} className="w-full" />
						</Form.Item>
					</div>

					<div className="flex justify-end">
						<Button loading={saving} type="submit">
							Save Changes
						</Button>
					</div>
				</Card>
			</Form>
		</div>
	);
}
