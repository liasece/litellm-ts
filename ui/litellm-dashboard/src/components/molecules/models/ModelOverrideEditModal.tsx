import NotificationsManager from "@/components/molecules/notifications_manager";
import { modelPatchUpdateCall } from "@/components/networking";
import { Modal, Select, Typography } from "antd";
import { useState } from "react";

const { Text } = Typography;

interface ModelOverrideEditModalProps {
	isOpen: boolean;
	modelId: string | null;
	modelName: string | null;
	currentOverride: string | null;
	availableModels: string[];
	accessToken: string | null;
	onCancel: () => void;
	onSuccess: () => void;
}

export default function ModelOverrideEditModal({
	isOpen,
	modelId,
	modelName,
	currentOverride,
	availableModels,
	accessToken,
	onCancel,
	onSuccess,
}: ModelOverrideEditModalProps) {
	const [selectedOverride, setSelectedOverride] = useState<string | undefined>(currentOverride || undefined);
	const [saving, setSaving] = useState(false);

	const handleSave = async () => {
		if (!accessToken || !modelId) return;
		setSaving(true);
		try {
			await modelPatchUpdateCall(
				accessToken,
				{ model_info: { override_model_name: selectedOverride || null } },
				modelId,
			);
			NotificationsManager.success(
				selectedOverride ? `Model override set to ${selectedOverride}` : "Model override removed",
			);
			onSuccess();
		} catch (error) {
			NotificationsManager.fromBackend(
				`Failed to update model override: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			setSaving(false);
		}
	};

	const options = availableModels
		.filter((name) => name !== modelName)
		.map((name) => ({ value: name, label: name }));

	return (
		<Modal
			title="Edit Model Override"
			open={isOpen}
			onCancel={onCancel}
			onOk={handleSave}
			confirmLoading={saving}
			okText="Save"
			destroyOnHidden
		>
			<div className="mt-2 flex flex-col gap-4">
				<div>
					<Text type="secondary" className="text-xs">
						Model
					</Text>
					<div>
						<Text strong>{modelName ?? "-"}</Text>
					</div>
				</div>
				<div>
					<Text type="secondary" className="text-xs">
						Override Target
					</Text>
					<Select
						aria-label="Override Target"
						className="w-full"
						placeholder="No override"
						value={selectedOverride}
						onChange={setSelectedOverride}
						options={options}
						showSearch
						allowClear
						optionFilterProp="label"
					/>
				</div>
				<Text type="secondary" className="text-xs">
					All requests for this model are routed to the target as if this model were an alias. Clear the selection to
					restore normal routing.
				</Text>
			</div>
		</Modal>
	);
}
