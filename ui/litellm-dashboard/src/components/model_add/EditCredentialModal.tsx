import { TextInput } from "@tremor/react";
import { Checkbox, Select as AntdSelect, Button, Form, Modal, Tooltip, Typography } from "antd";
import type { UploadProps } from "antd/es/upload";
import { useEffect, useState } from "react";
import ProviderSpecificFields from "../add_model/provider_specific_fields";
import { CredentialItem } from "../networking";
import { Providers, providerLogoMap } from "../provider_info_helpers";
const { Link } = Typography;

export interface EditCredentialFormValues extends Record<string, unknown> {
	credential_name: string;
	custom_llm_provider?: string;
	delete_secret_fields?: string[];
}

interface EditCredentialsModalProps {
	open: boolean;
	onCancel: () => void;
	onUpdateCredential: (values: EditCredentialFormValues) => void;
	uploadProps: UploadProps;
	existingCredential: CredentialItem | null;
}

export default function EditCredentialsModal({
	open,
	onCancel,
	onUpdateCredential,
	uploadProps,
	existingCredential,
}: EditCredentialsModalProps) {
	const [form] = Form.useForm();
	const [selectedProvider, setSelectedProvider] = useState<Providers>(Providers.Anthropic);

	const sensitiveFieldNames = new Set(
		Object.keys(existingCredential?.credential_values ?? {}).filter((key) =>
			/(?:key|token|secret|credential|password)/i.test(key),
		),
	);

	const handleSubmit = (values: Record<string, unknown>) => {
		const deleteSecretFields = Object.entries((values.delete_secret_fields ?? {}) as Record<string, boolean>)
			.filter(([, shouldDelete]) => shouldDelete)
			.map(([key]) => key);
		const filteredValues: EditCredentialFormValues = {
			credential_name: String(existingCredential?.credential_name ?? values.credential_name),
		};
		for (const [key, value] of Object.entries(values)) {
			if (
				key !== "credential_name" &&
				key !== "custom_llm_provider" &&
				key !== "delete_secret_fields" &&
				form.isFieldTouched(key) &&
				value !== "" &&
				value !== undefined &&
				value !== null &&
				!(typeof value === "string" && value.startsWith("****"))
			) {
				filteredValues[key] = value;
			}
		}
		if (
			form.isFieldTouched("custom_llm_provider") &&
			values.custom_llm_provider !== existingCredential?.credential_info.custom_llm_provider
		) {
			filteredValues.custom_llm_provider = String(values.custom_llm_provider);
		}
		if (deleteSecretFields.length > 0) {
			filteredValues.delete_secret_fields = deleteSecretFields;
		}
		onUpdateCredential(filteredValues);
		form.resetFields();
	};

	useEffect(() => {
		if (existingCredential) {
			// A GET response is masked, but secrets must never enter the editable form or DOM.
			const credentialValues = Object.entries(existingCredential.credential_values ?? {}).reduce<
				Record<string, unknown>
			>((acc, [key, value]) => {
				if (
					!/(?:key|token|secret|credential|password)/i.test(key) &&
					!(typeof value === "string" && value.startsWith("****"))
				) {
					acc[key] = value ?? null;
				}
				return acc;
			}, {});

			form.setFieldsValue({
				credential_name: existingCredential.credential_name,
				custom_llm_provider: existingCredential.credential_info.custom_llm_provider,
				...credentialValues,
			});
			setSelectedProvider(existingCredential.credential_info.custom_llm_provider as Providers);
		}
	}, [existingCredential, form]);

	return (
		<Modal
			title="Edit Credential"
			open={open}
			onCancel={() => {
				onCancel();
				form.resetFields();
			}}
			footer={null}
			width={600}
			destroyOnHidden={true}
		>
			<Form form={form} onFinish={handleSubmit} layout="vertical">
				{/* Credential Name */}
				<Form.Item
					label="Credential Name:"
					name="credential_name"
					rules={[{ required: true, message: "Credential name is required" }]}
					initialValue={existingCredential?.credential_name}
				>
					<TextInput
						placeholder="Enter a friendly name for these credentials"
						disabled={existingCredential?.credential_name ? true : false}
					/>
				</Form.Item>

				{/* Provider Selection */}
				<Form.Item
					rules={[{ required: true, message: "Required" }]}
					label="Provider:"
					name="custom_llm_provider"
					tooltip="Helper to auto-populate provider specific fields"
				>
					<AntdSelect
						showSearch
						onChange={(value) => {
							const providerFields = Object.keys(form.getFieldsValue()).filter(
								(key) => key !== "credential_name" && key !== "custom_llm_provider",
							);
							form.setFieldsValue(Object.fromEntries(providerFields.map((key) => [key, undefined])));
							setSelectedProvider(value as Providers);
							form.setFieldValue("custom_llm_provider", value);
						}}
					>
						{Object.entries(Providers).map(([providerEnum, providerDisplayName]) => (
							<AntdSelect.Option key={providerEnum} value={providerEnum}>
								<div className="flex items-center space-x-2">
									<img
										src={providerLogoMap[providerDisplayName]}
										alt={`${providerEnum} logo`}
										className="w-5 h-5"
										onError={(e) => {
											const target = e.target as HTMLImageElement;
											const parent = target.parentElement;
											if (parent) {
												const fallbackDiv = document.createElement("div");
												fallbackDiv.className =
													"w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-xs";
												fallbackDiv.textContent = providerDisplayName.charAt(0);
												parent.replaceChild(fallbackDiv, target);
											}
										}}
									/>
									<span>{providerDisplayName}</span>
								</div>
							</AntdSelect.Option>
						))}
					</AntdSelect>
				</Form.Item>

				<ProviderSpecificFields
					selectedProvider={selectedProvider}
					uploadProps={uploadProps}
					editMode
					configuredFieldNames={new Set(Object.keys(existingCredential?.credential_values ?? {}))}
				/>

				{[...sensitiveFieldNames].map((key) => (
					<Form.Item key={key} name={["delete_secret_fields", key]} valuePropName="checked">
						<Checkbox>Delete stored {key}</Checkbox>
					</Form.Item>
				))}

				{/* Modal Footer */}
				<div className="flex justify-between items-center">
					<Tooltip title="Get help on our github">
						<Link href="https://github.com/BerriAI/litellm/issues">Need Help?</Link>
					</Tooltip>

					<div>
						<Button
							onClick={() => {
								onCancel();
								form.resetFields();
							}}
							style={{ marginRight: 10 }}
						>
							Cancel
						</Button>
						<Button htmlType="submit">{"Update Credential"}</Button>
					</div>
				</div>
			</Form>
		</Modal>
	);
}
