import { InfoCircleOutlined } from "@ant-design/icons";
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
	const count = value && typeof value === "object" ? Object.keys(value as Record<string, unknown>).length : 0;
	return (
		<details className="group rounded bg-gray-50">
			<summary className="cursor-pointer select-none px-2 py-1 text-xs text-gray-500">
				{count} fields · expand JSON
			</summary>
			<pre className="max-h-80 overflow-auto border-t border-gray-200 p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
		</details>
	);
}

function CollapsedJsonEditor({ name, placeholder }: { name: string; placeholder: string }) {
	return (
		<details className="rounded border border-gray-200 bg-gray-50">
			<summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-600">
				Edit raw JSON
			</summary>
			<div className="border-t border-gray-200 p-2">
				<Form.Item name={name} className="mb-0" rules={[{ validator: formItemValidateJSON }]}>
					<Input.TextArea rows={8} className="font-mono text-xs" placeholder={placeholder} />
				</Form.Item>
			</div>
		</details>
	);
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

			<ModelSettingField
				label="Cache Control"
				editing={editing}
				fullWidth={editing}
				editor={
					<CacheControlSettings
						form={form}
						showCacheControl={showCacheControl}
						onCacheControlChange={onCacheControlChange}
					/>
				}
			>
				{litellmParams.cache_control_injection_points ? (
					<div className="space-y-1">
						{litellmParams.cache_control_injection_points.map((point: any, index: number) => (
							<div key={index} className="text-xs text-gray-600">
								{point.location}
								{point.role && <span> · {point.role}</span>}
								{point.index !== undefined && <span> · index {point.index}</span>}
							</div>
						))}
					</div>
				) : (
					"Not Set"
				)}
			</ModelSettingField>

			<ModelSettingField
				label="Model Info"
				editing={editing}
				fullWidth
				editor={<CollapsedJsonEditor name="model_info" placeholder='{"id": "...", "mode": "chat"}' />}
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
				fullWidth
				editor={
					<CollapsedJsonEditor
						name="litellm_extra_params"
						placeholder={`{
  "rpm": 100,
  "timeout": 0,
  "stream_timeout": 0
}`}
					/>
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
