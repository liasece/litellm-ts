import { Form, Input, type FormInstance } from "antd";
import EditLoggingSettings from "../EditLoggingSettings";

interface TeamAdvancedSettingsFieldsProps {
	form: FormInstance;
	premiumUser: boolean;
	mode?: "create" | "edit";
	showLoggingSettings?: boolean;
}

const validateJson = async (_: unknown, value: string) => {
	if (!value) return;
	try {
		JSON.parse(value);
	} catch {
		throw new Error("Please enter valid JSON");
	}
};

export default function TeamAdvancedSettingsFields({
	form,
	premiumUser,
	mode = "edit",
	showLoggingSettings = true,
}: TeamAdvancedSettingsFieldsProps) {
	return (
		<>
			<Form.Item label="Team ID" name="team_id" hidden={mode === "edit"}>
				<Input />
			</Form.Item>
			{mode === "edit" && (
				<Form.Item label="Organization ID" name="organization_id">
					<Input disabled />
				</Form.Item>
			)}
			{showLoggingSettings && (
				<Form.Item label="Logging Settings" name="logging_settings">
					<EditLoggingSettings
						value={form.getFieldValue("logging_settings")}
						onChange={(values) => form.setFieldValue("logging_settings", values)}
					/>
				</Form.Item>
			)}
			<Form.Item
				label="Secret Manager Settings"
				name="secret_manager_settings"
				help={
					premiumUser
						? "Enter secret manager configuration as a JSON object."
						: "Premium feature - Upgrade to manage secret manager settings."
				}
				rules={[{ validator: validateJson }]}
			>
				<Input.TextArea
					rows={6}
					placeholder='{"namespace": "admin", "mount": "secret", "path_prefix": "litellm"}'
					disabled={!premiumUser}
				/>
			</Form.Item>
			<Form.Item label="Metadata" name="metadata">
				<Input.TextArea rows={10} />
			</Form.Item>
		</>
	);
}
