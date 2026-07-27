import { useCallback, useEffect, useState } from "react";
import { Modal } from "antd";
import { deletePromptCall, getPromptsList, type PromptSpec } from "./networking";
import PromptTable from "./prompts/prompt_table";
import PromptInfoView from "./prompts/prompt_info";
import AddPromptForm from "./prompts/add_prompt_form";
import PromptEditorView from "./prompts/prompt_editor_view";
import NotificationsManager from "./molecules/notifications_manager";
import { isAdminRole } from "@/utils/roles";
import PromptsToolbar from "./prompts/PromptsToolbar";
import PromptDeleteModal from "./prompts/prompt_details/PromptDeleteModal";

interface PromptsProps {
	accessToken: string | null;
	userRole?: string;
}

const PromptsPanel = ({ accessToken, userRole }: PromptsProps) => {
	const [promptsList, setPromptsList] = useState<PromptSpec[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
	const [isAddModalVisible, setIsAddModalVisible] = useState(false);
	const [showEditorView, setShowEditorView] = useState(false);
	const [editPromptData, setEditPromptData] = useState<any>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [promptToDelete, setPromptToDelete] = useState<{ id: string; name: string } | null>(null);

	const isAdmin = userRole ? isAdminRole(userRole) : false;

	const fetchPrompts = useCallback(async () => {
		if (!accessToken) {
			setPromptsList([]);
			return;
		}

		setIsLoading(true);
		try {
			const response = await getPromptsList(accessToken);
			setPromptsList(response.prompts);
		} catch {
			NotificationsManager.fromBackend("Failed to load prompts");
		} finally {
			setIsLoading(false);
		}
	}, [accessToken]);

	useEffect(() => {
		void fetchPrompts();
	}, [fetchPrompts]);

	const handlePromptClick = (promptId: string) => {
		setSelectedPromptId(promptId);
	};

	const handleAddPrompt = () => {
		if (selectedPromptId) {
			setSelectedPromptId(null);
		}
		setEditPromptData(null);
		setShowEditorView(true);
	};

	const handleEditPrompt = (promptData: any) => {
		setEditPromptData(promptData);
		setShowEditorView(true);
	};

	const handleAddPromptFromFile = () => {
		if (selectedPromptId) {
			setSelectedPromptId(null);
		}
		setIsAddModalVisible(true);
	};

	const handleCloseModal = () => {
		setIsAddModalVisible(false);
	};

	const handleCloseEditor = () => {
		setShowEditorView(false);
		setEditPromptData(null);
	};

	const handleSuccess = () => {
		fetchPrompts();
		setShowEditorView(false);
		setEditPromptData(null);
		setSelectedPromptId(null);
	};

	const handleDeleteClick = (promptId: string, promptName: string) => {
		setPromptToDelete({ id: promptId, name: promptName });
	};

	const handleDeleteConfirm = async () => {
		if (!promptToDelete || !accessToken) return;

		setIsDeleting(true);
		try {
			await deletePromptCall(accessToken, promptToDelete.id);
			NotificationsManager.success(`Prompt "${promptToDelete.name}" deleted successfully`);
			await fetchPrompts();
		} catch {
			NotificationsManager.fromBackend("Failed to delete prompt");
		} finally {
			setIsDeleting(false);
			setPromptToDelete(null);
		}
	};

	const handleDeleteCancel = () => {
		setPromptToDelete(null);
	};

	return (
		<div className="w-full mx-auto flex-auto overflow-y-auto m-8 p-2">
			<PromptsToolbar disabled={!accessToken} onCreate={handleAddPrompt} onUpload={handleAddPromptFromFile} />

			<PromptTable
				promptsList={promptsList}
				isLoading={isLoading}
				onPromptClick={handlePromptClick}
				onDeleteClick={handleDeleteClick}
				accessToken={accessToken}
				isAdmin={isAdmin}
			/>

			{selectedPromptId && (
				<PromptInfoView
					promptId={selectedPromptId}
					onClose={() => setSelectedPromptId(null)}
					accessToken={accessToken}
					isAdmin={isAdmin}
					onDelete={fetchPrompts}
					onEdit={handleEditPrompt}
				/>
			)}

			<Modal
				open={showEditorView}
				onCancel={handleCloseEditor}
				footer={null}
				destroyOnHidden
				width="min(1440px, calc(100vw - 32px))"
				style={{ top: 16 }}
				styles={{ body: { height: "calc(100vh - 64px)", padding: 0, overflow: "hidden" } }}
			>
				<PromptEditorView
					onClose={handleCloseEditor}
					onSuccess={handleSuccess}
					accessToken={accessToken}
					initialPromptData={editPromptData}
				/>
			</Modal>

			<AddPromptForm
				visible={isAddModalVisible}
				onClose={handleCloseModal}
				accessToken={accessToken}
				onSuccess={handleSuccess}
			/>

			<PromptDeleteModal
				open={promptToDelete !== null}
				promptId={promptToDelete?.name ?? ""}
				deleting={isDeleting}
				onConfirm={() => void handleDeleteConfirm()}
				onCancel={handleDeleteCancel}
			/>
		</div>
	);
};

export default PromptsPanel;
