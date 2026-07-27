import { Checkbox, Form, Input, Select } from "antd";
import { CredentialItem } from "../networking";
import ModelSettingField from "./ModelSettingField";

interface ModelCredentialSettingsProps {
	editing: boolean;
	modelData: any;
	selectedCredentialName?: string;
	credentials: CredentialItem[];
}

export default function ModelCredentialSettings({
	editing,
	modelData,
	selectedCredentialName,
	credentials,
}: ModelCredentialSettingsProps) {
	return (
		<>
			<ModelSettingField
				label="Existing Credentials"
				editing={editing}
				editor={
					<Form.Item name="litellm_credential_name" label="Credential Source" className="mb-0">
						<Select
							showSearch
							placeholder="Select or search for existing credentials"
							optionFilterProp="children"
							filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
							options={[
								{ value: "", label: "Manual" },
								...credentials.map((credential) => ({
									value: credential.credential_name,
									label: credential.credential_name,
								})),
							]}
							allowClear
						/>
					</Form.Item>
				}
			>
				{modelData.litellm_params?.litellm_credential_name || "Manual"}
			</ModelSettingField>

			{editing && !selectedCredentialName && (
				<div>
					<Form.Item name="api_key" label="Manual API Key" className="mb-2">
						<Input.Password
							placeholder="Leave blank to keep the currently stored manual API key"
							autoComplete="new-password"
						/>
					</Form.Item>
					<Form.Item name="delete_api_key" valuePropName="checked" className="mb-0">
						<Checkbox>Delete stored manual API key</Checkbox>
					</Form.Item>
				</div>
			)}
		</>
	);
}
