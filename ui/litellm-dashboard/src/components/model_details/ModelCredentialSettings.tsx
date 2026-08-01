import { Checkbox, Form, Input, Select } from "antd";
import { CredentialItem } from "../networking";
import ModelSettingField from "./ModelSettingField";

interface ModelCredentialSettingsProps {
	editing: boolean;
	modelData: any;
	selectedCredentialName?: string;
	credentials: CredentialItem[];
	selectedProvider?: string;
}

export default function ModelCredentialSettings({
	editing,
	modelData,
	selectedCredentialName,
	credentials,
	selectedProvider,
}: ModelCredentialSettingsProps) {
	const isManagedCliProxy = editing && selectedProvider === "cliproxy";

	if (isManagedCliProxy) {
		return (
			<ModelSettingField
				label="Credentials"
				editing
				editor={
					<div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
						CLIProxy uses the managed runtime endpoint and internal key. No API key is required.
					</div>
				}
			>
				Managed by CLIProxy
			</ModelSettingField>
		);
	}

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
							placeholder="No API key configured"
							autoComplete="off"
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
