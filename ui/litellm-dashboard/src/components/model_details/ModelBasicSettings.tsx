import { Form, Select } from "antd";
import { TextInput } from "@tremor/react";
import NumericalInput from "../shared/numerical_input";
import ModelSettingField from "./ModelSettingField";
import ModelValueList from "./ModelValueList";

interface ModelBasicSettingsProps {
	editing: boolean;
	modelData: any;
	modelAccessGroups: string[] | null;
}

export default function ModelBasicSettings({ editing, modelData, modelAccessGroups }: ModelBasicSettingsProps) {
	const litellmParams = modelData.litellm_params ?? {};
	const modelInfo = modelData.model_info ?? {};

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
				editor={
					<Form.Item name="litellm_model_name" className="mb-0">
						<TextInput placeholder="Enter LiteLLM model name" />
					</Form.Item>
				}
			>
				{modelData.litellm_model_name}
			</ModelSettingField>
			<ModelSettingField
				label="Input Cost (per 1M tokens)"
				editing={editing}
				editor={
					<Form.Item name="input_cost" className="mb-0">
						<NumericalInput placeholder="Enter input cost" />
					</Form.Item>
				}
			>
				{litellmParams.input_cost_per_token != null
					? (litellmParams.input_cost_per_token * 1_000_000).toFixed(4)
					: modelInfo.input_cost_per_token != null
						? (modelInfo.input_cost_per_token * 1_000_000).toFixed(4)
						: "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Output Cost (per 1M tokens)"
				editing={editing}
				editor={
					<Form.Item name="output_cost" className="mb-0">
						<NumericalInput placeholder="Enter output cost" />
					</Form.Item>
				}
			>
				{litellmParams.output_cost_per_token != null
					? (litellmParams.output_cost_per_token * 1_000_000).toFixed(4)
					: modelInfo.output_cost_per_token != null
						? (modelInfo.output_cost_per_token * 1_000_000).toFixed(4)
						: "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="API Base"
				editing={editing}
				editor={
					<Form.Item name="api_base" className="mb-0">
						<TextInput placeholder="Enter API base" />
					</Form.Item>
				}
			>
				{litellmParams.api_base || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Custom LLM Provider"
				editing={editing}
				editor={
					<Form.Item name="custom_llm_provider" className="mb-0">
						<TextInput placeholder="Enter custom LLM provider" />
					</Form.Item>
				}
			>
				{litellmParams.custom_llm_provider || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Organization"
				editing={editing}
				editor={
					<Form.Item name="organization" className="mb-0">
						<TextInput placeholder="Enter organization" />
					</Form.Item>
				}
			>
				{litellmParams.organization || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="TPM (Tokens per Minute)"
				editing={editing}
				editor={
					<Form.Item name="tpm" className="mb-0">
						<NumericalInput placeholder="Enter TPM" />
					</Form.Item>
				}
			>
				{litellmParams.tpm || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="RPM (Requests per Minute)"
				editing={editing}
				editor={
					<Form.Item name="rpm" className="mb-0">
						<NumericalInput placeholder="Enter RPM" />
					</Form.Item>
				}
			>
				{litellmParams.rpm || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Max Retries"
				editing={editing}
				editor={
					<Form.Item name="max_retries" className="mb-0">
						<NumericalInput placeholder="Enter max retries" />
					</Form.Item>
				}
			>
				{litellmParams.max_retries || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Timeout (seconds)"
				editing={editing}
				editor={
					<Form.Item name="timeout" className="mb-0">
						<NumericalInput placeholder="Enter timeout" />
					</Form.Item>
				}
			>
				{litellmParams.timeout || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label="Stream Timeout (seconds)"
				editing={editing}
				editor={
					<Form.Item name="stream_timeout" className="mb-0">
						<NumericalInput placeholder="Enter stream timeout" />
					</Form.Item>
				}
			>
				{litellmParams.stream_timeout || "Not Set"}
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
