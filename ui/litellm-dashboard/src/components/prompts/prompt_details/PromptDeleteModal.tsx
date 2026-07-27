import { Modal } from "antd";

interface PromptDeleteModalProps {
	open: boolean;
	promptId: string;
	deleting: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export default function PromptDeleteModal({ open, promptId, deleting, onConfirm, onCancel }: PromptDeleteModalProps) {
	return (
		<Modal
			title="Delete Prompt"
			open={open}
			onOk={onConfirm}
			onCancel={onCancel}
			confirmLoading={deleting}
			okText="Delete"
			okButtonProps={{ danger: true }}
			destroyOnHidden
		>
			<p>
				Are you sure you want to delete prompt: <strong>{promptId}</strong>?
			</p>
			<p>This action cannot be undone.</p>
		</Modal>
	);
}
