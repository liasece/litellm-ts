import { Form, Select, Tooltip } from "antd";
import { TextInput } from "@tremor/react";
import { InfoCircleOutlined } from "@ant-design/icons";
import NumericalInput from "../shared/numerical_input";
import type { CredentialValues } from "../networking";
import ModelSettingField from "./ModelSettingField";
import ModelValueList from "./ModelValueList";

interface ModelBasicSettingsProps {
	editing: boolean;
	modelData: any;
	modelAccessGroups: string[] | null;
	credentialValues?: CredentialValues;
	availableModelNames: string[];
}

function CredentialValue({
	value,
	format = String,
}: {
	value: unknown;
	format?: (value: any) => string;
}) {
	return (
		<span className="text-gray-400">
			{format(value)}
			<span className="ml-1 text-xs">(from Credentials)</span>
		</span>
	);
}

export default function ModelBasicSettings({
	editing,
	modelData,
	modelAccessGroups,
	credentialValues,
	availableModelNames,
}: ModelBasicSettingsProps) {
	const litellmParams = modelData.litellm_params ?? {};
	const modelInfo = modelData.model_info ?? {};
	const hasCredentialValue = (key: string) =>
		credentialValues !== undefined && Object.prototype.hasOwnProperty.call(credentialValues, key);
	const resolvedValue = (key: string, fallback: React.ReactNode, format?: (value: any) => string) =>
		hasCredentialValue(key) ? <CredentialValue value={credentialValues?.[key]} format={format} /> : fallback;
	const resolvedEditor = (key: string, editor: React.ReactNode, format?: (value: any) => string) =>
		hasCredentialValue(key) ? (
			<>
				<div className="hidden">{editor}</div>
				<div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
					<CredentialValue value={credentialValues?.[key]} format={format} />
				</div>
			</>
		) : (
			editor
		);

	return (
		<>
			<ModelSettingField
				label="Model Name"
				editing={editing}
				editor={
					<Form.Item name="model_name" className="mb-0">
						<TextInput placeholder="Enter model name" />
					</Form.Item>
				}
			>
				{modelData.model_name}
			</ModelSettingField>
			<ModelSettingField
				label="LiteLLM Model Name"
				editing={editing}
				editor={resolvedEditor(
					"model",
					<Form.Item name="litellm_model_name" className="mb-0">
						<TextInput placeholder="Enter LiteLLM model name" />
					</Form.Item>,
				)}
			>
				{resolvedValue("model", modelData.litellm_model_name)}
			</ModelSettingField>
			<ModelSettingField
				label={
					<>
						Model Override
						<Tooltip title="Always route requests for this model to the selected target, with alias semantics.">
							<InfoCircleOutlined className="ml-1" />
						</Tooltip>
					</>
				}
				editing={editing}
				editor={
					<Form.Item name="override_model_name" className="mb-0">
						<Select
							showSearch
							allowClear
							placeholder="No override"
							optionFilterProp="label"
							options={availableModelNames
								.filter((name) => name !== modelData.model_name)
								.map((name) => ({ value: name, label: name }))}
						/>
					</Form.Item>
				}
			>
				{modelInfo.override_model_name || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Input Cost (per 1M tokens)"
				editing={editing}
				editor={resolvedEditor(
					"input_cost_per_token",
					<Form.Item name="input_cost" className="mb-0">
						<NumericalInput placeholder="Enter input cost" />
					</Form.Item>,
					(value) => (Number(value) * 1_000_000).toFixed(4),
				)}
			>
				{resolvedValue(
					"input_cost_per_token",
					litellmParams.input_cost_per_token != null
						? (litellmParams.input_cost_per_token * 1_000_000).toFixed(4)
						: modelInfo.input_cost_per_token != null
							? (modelInfo.input_cost_per_token * 1_000_000).toFixed(4)
							: "Not Set",
					(value) => (Number(value) * 1_000_000).toFixed(4),
				)}
			</ModelSettingField>
			<ModelSettingField
				label="Output Cost (per 1M tokens)"
				editing={editing}
				editor={resolvedEditor(
					"output_cost_per_token",
					<Form.Item name="output_cost" className="mb-0">
						<NumericalInput placeholder="Enter output cost" />
					</Form.Item>,
					(value) => (Number(value) * 1_000_000).toFixed(4),
				)}
			>
				{resolvedValue(
					"output_cost_per_token",
					litellmParams.output_cost_per_token != null
						? (litellmParams.output_cost_per_token * 1_000_000).toFixed(4)
						: modelInfo.output_cost_per_token != null
							? (modelInfo.output_cost_per_token * 1_000_000).toFixed(4)
							: "Not Set",
					(value) => (Number(value) * 1_000_000).toFixed(4),
				)}
			</ModelSettingField>
			<ModelSettingField
				label="API Base"
				editing={editing}
				editor={resolvedEditor(
					"api_base",
					<Form.Item name="api_base" className="mb-0">
						<TextInput placeholder="Enter API base" />
					</Form.Item>,
				)}
			>
				{resolvedValue("api_base", litellmParams.api_base || "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Custom LLM Provider"
				editing={editing}
				editor={resolvedEditor(
					"custom_llm_provider",
					<Form.Item name="custom_llm_provider" className="mb-0">
						<TextInput placeholder="Enter custom LLM provider" />
					</Form.Item>,
				)}
			>
				{resolvedValue("custom_llm_provider", litellmParams.custom_llm_provider || "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Organization"
				editing={editing}
				editor={resolvedEditor(
					"organization",
					<Form.Item name="organization" className="mb-0">
						<TextInput placeholder="Enter organization" />
					</Form.Item>,
				)}
			>
				{resolvedValue("organization", litellmParams.organization || "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="TPM (Tokens per Minute)"
				editing={editing}
				editor={resolvedEditor(
					"tpm",
					<Form.Item name="tpm" className="mb-0">
						<NumericalInput placeholder="Enter TPM" />
					</Form.Item>,
				)}
			>
				{resolvedValue("tpm", litellmParams.tpm ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="RPM (Requests per Minute)"
				editing={editing}
				editor={resolvedEditor(
					"rpm",
					<Form.Item name="rpm" className="mb-0">
						<NumericalInput placeholder="Enter RPM" />
					</Form.Item>,
				)}
			>
				{resolvedValue("rpm", litellmParams.rpm ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Max Retries"
				editing={editing}
				editor={resolvedEditor(
					"max_retries",
					<Form.Item name="max_retries" className="mb-0">
						<NumericalInput placeholder="Enter max retries" />
					</Form.Item>,
				)}
			>
				{resolvedValue("max_retries", litellmParams.max_retries ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Timeout (seconds)"
				editing={editing}
				editor={resolvedEditor(
					"timeout",
					<Form.Item name="timeout" className="mb-0">
						<NumericalInput placeholder="Enter timeout" />
					</Form.Item>,
				)}
			>
				{resolvedValue("timeout", litellmParams.timeout ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Stream Timeout (seconds)"
				editing={editing}
				editor={resolvedEditor(
					"stream_timeout",
					<Form.Item name="stream_timeout" className="mb-0">
						<NumericalInput placeholder="Enter stream timeout" />
					</Form.Item>,
				)}
			>
				{resolvedValue("stream_timeout", litellmParams.stream_timeout ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Model Access Groups"
				editing={editing}
				fullWidth
				editor={
					<Form.Item name="model_access_group" className="mb-0">
						<Select
							mode="tags"
							showSearch
							placeholder="Select existing groups or type to create new ones"
							optionFilterProp="children"
							tokenSeparators={[","]}
							maxTagCount="responsive"
							allowClear
							style={{ width: "100%" }}
							options={modelAccessGroups?.map((group) => ({ value: group, label: group }))}
						/>
					</Form.Item>
				}
			>
				<ModelValueList
					value={modelInfo.access_groups}
					emptyLabel="No groups assigned"
					pillClassName="bg-blue-100 text-blue-800"
				/>
			</ModelSettingField>
		</>
	);
}
