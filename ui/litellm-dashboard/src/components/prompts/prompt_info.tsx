import { deletePromptCall, getPromptInfo, type PromptSpec, type PromptTemplateBase } from "@/components/networking";
import { copyToClipboard as utilCopyToClipboard } from "@/utils/dataUtils";
import { Tab, TabGroup, TabList, TabPanels } from "@tremor/react";
import { Button } from "antd";
import { useCallback, useEffect, useState } from "react";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import NotificationsManager from "../molecules/notifications_manager";
import PromptCodeSnippets from "./prompt_editor_view/PromptCodeSnippets";
import PromptAdminDetailsPanel from "./prompt_details/PromptAdminDetailsPanel";
import PromptDeleteModal from "./prompt_details/PromptDeleteModal";
import PromptIdentifierBar from "./prompt_details/PromptIdentifierBar";
import PromptOverviewPanel from "./prompt_details/PromptOverviewPanel";
import PromptRawJsonPanel from "./prompt_details/PromptRawJsonPanel";
import PromptTemplatePanel from "./prompt_details/PromptTemplatePanel";
import { extractModel, extractTemplateVariables, getBasePromptId, getCurrentVersion } from "./prompt_utils";

export interface PromptInfoProps {
	promptId: string;
	onClose: () => void;
	accessToken: string | null;
	isAdmin: boolean;
	onDelete?: () => void;
	onEdit?: (promptData: unknown) => void;
}

type PromptInfoResponse = Awaited<ReturnType<typeof getPromptInfo>>;

export default function PromptInfoView({ promptId, onClose, accessToken, isAdmin, onDelete, onEdit }: PromptInfoProps) {
	const [promptData, setPromptData] = useState<PromptSpec | null>(null);
	const [promptTemplate, setPromptTemplate] = useState<PromptTemplateBase | null>(null);
	const [rawApiResponse, setRawApiResponse] = useState<PromptInfoResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const fetchPromptInfo = useCallback(async () => {
		setLoading(true);
		if (!accessToken) {
			setPromptData(null);
			setPromptTemplate(null);
			setRawApiResponse(null);
			setLoading(false);
			return;
		}

		try {
			const response = await getPromptInfo(accessToken, promptId);
			setPromptData(response.prompt_spec);
			setPromptTemplate(response.raw_prompt_template);
			setRawApiResponse(response);
		} catch {
			setPromptData(null);
			setPromptTemplate(null);
			setRawApiResponse(null);
			NotificationsManager.fromBackend("Failed to load prompt information");
		} finally {
			setLoading(false);
		}
	}, [accessToken, promptId]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- The async loader owns the loading and result state.
		void fetchPromptInfo();
	}, [fetchPromptInfo]);

	const copyToClipboard = async (text: string | null | undefined, key: string) => {
		if (!(await utilCopyToClipboard(text))) return;

		setCopiedStates((previous) => ({ ...previous, [key]: true }));
		window.setTimeout(() => {
			setCopiedStates((previous) => ({ ...previous, [key]: false }));
		}, 2000);
	};

	if (loading) {
		return (
			<ResourceDetailsDrawer open onClose={onClose} title="Prompt Details" loading>
				<div />
			</ResourceDetailsDrawer>
		);
	}

	if (!promptData) {
		return (
			<ResourceDetailsDrawer open onClose={onClose} title="Prompt Details">
				<div className="p-4">Prompt not found</div>
			</ResourceDetailsDrawer>
		);
	}

	const promptModel = extractModel(promptData) || "gpt-4o";
	const basePromptId = getBasePromptId(promptData);
	const currentVersion = getCurrentVersion(promptData);

	const handleDeleteConfirm = async () => {
		if (!accessToken) return;

		setIsDeleting(true);
		try {
			await deletePromptCall(accessToken, basePromptId);
			NotificationsManager.success(`Prompt "${basePromptId}" deleted successfully`);
			onDelete?.();
			onClose();
		} catch {
			NotificationsManager.fromBackend("Failed to delete prompt");
		} finally {
			setIsDeleting(false);
			setShowDeleteConfirm(false);
		}
	};

	const tabs = [
		<Tab key="overview">Overview</Tab>,
		...(promptTemplate ? [<Tab key="template">Prompt Template</Tab>] : []),
		...(isAdmin ? [<Tab key="details">Details</Tab>] : []),
		<Tab key="raw">Raw JSON</Tab>,
	];
	const panels = [
		<PromptOverviewPanel key="overview" prompt={promptData} promptId={basePromptId} version={currentVersion} />,
		...(promptTemplate
			? [
					<PromptTemplatePanel
						key="template"
						template={promptTemplate}
						copied={Boolean(copiedStates["prompt-content"])}
						onCopy={copyToClipboard}
					/>,
				]
			: []),
		...(isAdmin ? [<PromptAdminDetailsPanel key="details" prompt={promptData} promptId={basePromptId} />] : []),
		<PromptRawJsonPanel
			key="raw"
			response={rawApiResponse}
			copied={Boolean(copiedStates["raw-json"])}
			onCopy={copyToClipboard}
		/>,
	];

	return (
		<ResourceDetailsDrawer
			open
			onClose={onClose}
			title="Prompt Details"
			subtitle={basePromptId}
			actions={
				<>
					<PromptCodeSnippets
						promptId={basePromptId}
						model={promptModel}
						promptVariables={extractTemplateVariables(promptTemplate?.content)}
						accessToken={accessToken}
						version={currentVersion}
					/>
					<Button onClick={() => onEdit?.(rawApiResponse)}>Edit</Button>
					{isAdmin && (
						<Button danger onClick={() => setShowDeleteConfirm(true)}>
							Delete
						</Button>
					)}
				</>
			}
		>
			<div className="p-4">
				<PromptIdentifierBar
					promptId={basePromptId}
					copied={Boolean(copiedStates["prompt-id"])}
					onCopy={copyToClipboard}
				/>

				<TabGroup>
					<TabList className="mb-4">{tabs}</TabList>
					<TabPanels>{panels}</TabPanels>
				</TabGroup>

				<PromptDeleteModal
					open={showDeleteConfirm}
					promptId={basePromptId}
					deleting={isDeleting}
					onConfirm={() => void handleDeleteConfirm()}
					onCancel={() => setShowDeleteConfirm(false)}
				/>
			</div>
		</ResourceDetailsDrawer>
	);
}
