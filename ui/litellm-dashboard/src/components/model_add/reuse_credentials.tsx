import React, { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Tooltip, Typography } from "antd";
import { CredentialItem } from "../networking";
const { Link } = Typography;

interface ReuseCredentialsModalProps {
	isVisible: boolean;
	onCancel: () => void;
	onAddCredential: (values: { credential_name: string }) => void | Promise<void>;
	existingCredential: CredentialItem | null;
	setIsCredentialModalOpen: (isVisible: boolean) => void;
}

const ReuseCredentialsModal: React.FC<ReuseCredentialsModalProps> = ({
	isVisible,
	onCancel,
	onAddCredential,
	existingCredential,
	setIsCredentialModalOpen,
}) => {
	const [form] = Form.useForm();
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		if (isVisible) {
			form.setFieldsValue({ credential_name: existingCredential?.credential_name ?? "" });
		}
	}, [existingCredential?.credential_name, form, isVisible]);

	const handleSubmit = async (values: { credential_name: string }) => {
		if (!existingCredential || isSubmitting) {
			return;
		}
		setIsSubmitting(true);
		try {
			await onAddCredential({ credential_name: values.credential_name.trim() });
			form.resetFields();
			setIsCredentialModalOpen(false);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Modal
			title="Reuse Credentials"
			open={isVisible}
			onCancel={() => {
				onCancel();
				form.resetFields();
			}}
			footer={null}
			width={600}
		>
			<Form form={form} onFinish={handleSubmit} layout="vertical">
				<Form.Item
					label="New Credential Name"
					name="credential_name"
					rules={[
						{ required: true, whitespace: true, message: "Enter a credential name" },
						{
							validator: (_, value) =>
								value?.trim() ? Promise.resolve() : Promise.reject(new Error("Enter a credential name")),
						},
					]}
				>
					<Input autoComplete="off" />
				</Form.Item>
				<p className="mb-3 text-xs text-gray-500">
					A new credential with this name will be created and bound to the model.
				</p>
				<dl className="space-y-3">
					<div>
						<dt className="font-medium">Credential Name</dt>
						<dd>{existingCredential?.credential_name ?? "Not available"}</dd>
					</div>
					<div>
						<dt className="font-medium">Provider</dt>
						<dd>{existingCredential?.credential_info.custom_llm_provider ?? "Not set"}</dd>
					</div>
					<div>
						<dt className="font-medium">Configured Fields</dt>
						<dd>
							{Object.keys(existingCredential?.credential_values ?? {}).length > 0 ? (
								<ul>
									{Object.keys(existingCredential?.credential_values ?? {}).map((fieldName) => (
										<li key={fieldName}>{fieldName}</li>
									))}
								</ul>
							) : (
								"None"
							)}
						</dd>
					</div>
				</dl>

				<div className="flex justify-between items-center mt-6">
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
						<Button htmlType="submit" disabled={!existingCredential || isSubmitting} loading={isSubmitting}>
							Reuse Credentials
						</Button>
					</div>
				</div>
			</Form>
		</Modal>
	);
};

export default ReuseCredentialsModal;
