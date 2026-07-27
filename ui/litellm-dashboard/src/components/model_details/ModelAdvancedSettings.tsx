import { InfoCircleOutlined } from "@ant-design/icons";
import { Text } from "@tremor/react";
import { Form, Input, Select, Tooltip, type FormInstance } from "antd";
import CacheControlSettings from "../add_model/cache_control_settings";
import { formItemValidateJSON } from "../../utils/textUtils";
import ModelSettingField from "./ModelSettingField";

interface ModelAdvancedSettingsProps {
	editing: boolean;
	modelData: any;
	isWildcardModel: boolean;
	modelHubData: any;
	form: FormInstance;
	showCacheControl: boolean;
	onCacheControlChange: (enabled: boolean) => void;
}

function JsonValue({ value }: { value: unknown }) {
	return <pre className="mt-1 overflow-auto rounded bg-gray-100 p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export default function ModelAdvancedSettings({
	editing,
	modelData,
	isWildcardModel,
	modelHubData,
	form,
	showCacheControl,
	onCacheControlChange,
}: ModelAdvancedSettingsProps) {
	const litellmParams = modelData.litellm_params ?? {};

	return (
		<>
			{isWildcardModel && (
				<ModelSettingField
					label="Health Check Model"
					editing={editing}
					editor={
						<Form.Item name="health_check_model" className="mb-0">
							<Select
								showSearch
								placeholder="Select existing health check model"
								optionFilterProp="children"
								allowClear
								options={
									modelHubData?.data
										?.filter(
											(model: any) =>
												model.providers?.includes(modelData.litellm_model_name.split("/")[0]) &&
												model.model_group !== modelData.litellm_model_name,
										)
										.map((model: any) => ({
											value: model.model_group,
											label: model.model_group,
										})) || []
								}
							/>
						</Form.Item>
					}
				>
					{modelData.model_info?.health_check_model || "Not Set"}
				</ModelSettingField>
			)}

			{editing ? (
				<CacheControlSettings
					form={form}
					showCacheControl={showCacheControl}
					onCacheControlChange={onCacheControlChange}
				/>
			) : (
				<div>
					<Text className="font-medium">Cache Control</Text>
					<div className="mt-1 rounded bg-gray-50 p-2">
						{litellmParams.cache_control_injection_points ? (
							<div>
								<p>Enabled</p>
								<div className="mt-2">
									{litellmParams.cache_control_injection_points.map((point: any, index: number) => (
										<div key={index} className="mb-1 text-sm text-gray-600">
											Location: {point.location}
											{point.role && <span>, Role: {point.role}</span>}
											{point.index !== undefined && <span>, Index: {point.index}</span>}
										</div>
									))}
								</div>
							</div>
						) : (
							"Disabled"
						)}
					</div>
				</div>
			)}

			<ModelSettingField
				label="Model Info"
				editing={editing}
				editor={
					<Form.Item name="model_info" className="mb-0">
						<Input.TextArea rows={4} placeholder='{"gpt-4": 100, "claude-v1": 200}' />
					</Form.Item>
				}
			>
				<JsonValue value={modelData.model_info} />
			</ModelSettingField>
			<ModelSettingField
				label={
					<>
						LiteLLM Params
						<Tooltip title="Optional litellm params used for making a litellm.completion() call. Some params are automatically added by LiteLLM.">
							<a
								href="https://docs.litellm.ai/docs/completion/input"
								target="_blank"
								rel="noopener noreferrer"
								onClick={(event) => event.stopPropagation()}
							>
								<InfoCircleOutlined style={{ marginLeft: 4 }} />
							</a>
						</Tooltip>
					</>
				}
				editing={editing}
				editor={
					<Form.Item name="litellm_extra_params" rules={[{ validator: formItemValidateJSON }]}>
						<Input.TextArea
							rows={4}
							placeholder={`{
  "rpm": 100,
  "timeout": 0,
  "stream_timeout": 0
}`}
						/>
					</Form.Item>
				}
			>
				<JsonValue value={litellmParams} />
			</ModelSettingField>
			<ModelSettingField label="Team ID" editing={false} editor={null}>
				{modelData.model_info?.team_id || "Not Set"}
			</ModelSettingField>
		</>
	);
}
