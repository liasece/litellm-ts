import { Form, Modal, type FormInstance } from "antd";
import type { ModelSettingsContentProps } from "./ModelSettingsContent";
import ModelSettingsContent from "./ModelSettingsContent";

interface ModelSettingsDialogProps extends Omit<ModelSettingsContentProps, "editing" | "onCancel"> {
	open: boolean;
	onCancel: () => void;
	onSave: (values: any) => void;
}

function getInitialValues(modelData: any, isWildcardModel: boolean) {
	const litellmParams = modelData.litellm_params ?? {};
	const modelInfo = modelData.model_info ?? {};

	return {
		model_name: modelData.model_name,
		litellm_model_name: modelData.litellm_model_name,
		api_base: litellmParams.api_base,
		custom_llm_provider: litellmParams.custom_llm_provider,
		organization: litellmParams.organization,
		tpm: litellmParams.tpm,
		rpm: litellmParams.rpm,
		max_retries: litellmParams.max_retries,
		timeout: litellmParams.timeout,
		stream_timeout: litellmParams.stream_timeout,
		input_cost: litellmParams.input_cost_per_token
			? litellmParams.input_cost_per_token * 1_000_000
			: modelInfo.input_cost_per_token * 1_000_000 || null,
		output_cost: litellmParams.output_cost_per_token
			? litellmParams.output_cost_per_token * 1_000_000
			: modelInfo.output_cost_per_token * 1_000_000 || null,
		cache_control: Boolean(litellmParams.cache_control_injection_points),
		cache_control_injection_points: litellmParams.cache_control_injection_points || [],
		model_access_group: Array.isArray(modelInfo.access_groups) ? modelInfo.access_groups : [],
		guardrails: Array.isArray(litellmParams.guardrails) ? litellmParams.guardrails : [],
		vector_store_ids: Array.isArray(litellmParams.vector_store_ids) ? litellmParams.vector_store_ids : [],
		tags: Array.isArray(litellmParams.tags) ? litellmParams.tags : [],
		health_check_model: isWildcardModel ? modelInfo.health_check_model : null,
		litellm_credential_name: litellmParams.litellm_credential_name || "",
		api_key: "",
		delete_api_key: false,
		model_info: JSON.stringify(modelInfo, null, 2),
		litellm_extra_params: JSON.stringify(
			Object.fromEntries(
				Object.entries(litellmParams).filter(([key]) => key !== "litellm_credential_name" && key !== "api_key"),
			),
			null,
			2,
		),
	};
}

export default function ModelSettingsDialog({
	open,
	onCancel,
	onSave,
	modelData,
	form,
	isWildcardModel,
	...contentProps
}: ModelSettingsDialogProps) {
	const resetAndClose = () => {
		(form as FormInstance).resetFields();
		onCancel();
	};

	return (
		<Modal
			open={open}
			title="Edit Model Settings"
			footer={null}
			width="min(960px, calc(100vw - 32px))"
			destroyOnHidden
			onCancel={resetAndClose}
		>
			<Form
				form={form}
				onFinish={onSave}
				initialValues={getInitialValues(modelData, isWildcardModel)}
				layout="vertical"
			>
				<ModelSettingsContent
					{...contentProps}
					editing
					modelData={modelData}
					form={form}
					isWildcardModel={isWildcardModel}
					onCancel={resetAndClose}
				/>
			</Form>
		</Modal>
	);
}
