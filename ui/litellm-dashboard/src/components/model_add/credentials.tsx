import {
	credentialCreateCall,
	credentialDeleteCall,
	CredentialItem,
	type CredentialValues,
	credentialUpdateCall,
} from "@/components/networking"; // Assume this is your networking function
import { PencilAltIcon, TrashIcon } from "@heroicons/react/outline";
import {
	Badge,
	Button,
	Card,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeaderCell,
	TableRow,
	Text,
} from "@tremor/react";
import { Descriptions, Form } from "antd";
import { UploadProps } from "antd/es/upload";
import { useState } from "react";
import DeleteResourceModal from "../common_components/DeleteResourceModal";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import NotificationsManager from "../molecules/notifications_manager";
import AddCredentialsTab from "./AddCredentialModal";
import EditCredentialsModal, { type EditCredentialFormValues } from "./EditCredentialModal";
import { useCredentials } from "@/app/(dashboard)/hooks/credentials/useCredentials";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
interface CredentialsPanelProps {
	uploadProps: UploadProps;
}

const CredentialsPanel: React.FC<CredentialsPanelProps> = ({ uploadProps }) => {
	const { accessToken } = useAuthorized();
	const { data: credentialsResponse, refetch: refetchCredentials } = useCredentials();
	const credentialList = credentialsResponse?.credentials || [];

	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
	const [selectedCredential, setSelectedCredential] = useState<CredentialItem | null>(null);
	const [credentialToDelete, setCredentialToDelete] = useState<CredentialItem | null>(null);
	const [credentialDetails, setCredentialDetails] = useState<CredentialItem | null>(null);
	const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
	const [isCredentialDeleting, setIsCredentialDeleting] = useState(false);
	const [form] = Form.useForm();

	const restrictedFields = ["credential_name", "custom_llm_provider"];
	const handleUpdateCredential = async (values: EditCredentialFormValues) => {
		if (!accessToken) {
			return;
		}

		const deleteSecretFields = Array.isArray(values.delete_secret_fields) ? values.delete_secret_fields : [];
		const filter_credential_values = Object.entries(values)
			.filter(([key, value]) => !restrictedFields.includes(key) && key !== "delete_secret_fields" && value !== "")
			.reduce<CredentialValues>((acc, [key, value]) => ({ ...acc, [key]: value as CredentialValues[string] }), {});
		for (const key of deleteSecretFields) {
			filter_credential_values[key] = null;
		}
		// Transform form values into credential structure
		const newCredential = {
			credential_name: values.credential_name,
			credential_values: filter_credential_values,
			...(values.custom_llm_provider ? { credential_info: { custom_llm_provider: values.custom_llm_provider } } : {}),
		};

		await credentialUpdateCall(accessToken, values.credential_name, newCredential);
		NotificationsManager.success("Credential updated successfully");
		setIsUpdateModalOpen(false);
		await refetchCredentials();
	};

	const handleAddCredential = async (values: EditCredentialFormValues) => {
		if (!accessToken) {
			return;
		}

		const filter_credential_values = Object.entries(values)
			.filter(([key]) => !restrictedFields.includes(key))
			.reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
		// Transform form values into credential structure
		const newCredential = {
			credential_name: values.credential_name,
			credential_values: filter_credential_values,
			credential_info: {
				custom_llm_provider: values.custom_llm_provider,
			},
		};

		// Add to list and close modal
		await credentialCreateCall(accessToken, newCredential);
		NotificationsManager.success("Credential added successfully");
		setIsAddModalOpen(false);
		await refetchCredentials();
	};

	const renderProviderBadge = (provider: string) => {
		const providerColors: Record<string, string> = {
			openai: "blue",
			azure: "indigo",
			anthropic: "purple",
			default: "gray",
		};

		const color = providerColors[provider.toLowerCase()] || providerColors["default"];
		return (
			<Badge color={color as any} size="xs">
				{provider}
			</Badge>
		);
	};

	const handleDeleteCredential = async () => {
		if (!accessToken || !credentialToDelete) {
			return;
		}
		setIsCredentialDeleting(true);
		try {
			await credentialDeleteCall(accessToken, credentialToDelete.credential_name);
			NotificationsManager.success("Credential deleted successfully");
			await refetchCredentials();
		} catch (error) {
			NotificationsManager.error(error instanceof Error ? error.message : "Failed to delete credential");
		} finally {
			setCredentialToDelete(null);
			setIsDeleteModalOpen(false);
			setIsCredentialDeleting(false);
		}
	};

	const openDeleteModal = (credential: CredentialItem) => {
		setCredentialToDelete(credential);
		setIsDeleteModalOpen(true);
	};

	const closeDeleteModal = () => {
		setCredentialToDelete(null);
		setIsDeleteModalOpen(false);
	};

	return (
		<div className="w-full mx-auto flex-auto overflow-y-auto p-2">
			<Button onClick={() => setIsAddModalOpen(true)}>Add Credential</Button>
			<div className="flex justify-between items-center mt-4 mb-4">
				<Text>Configured credentials for different AI providers. Add and manage your API credentials.</Text>
			</div>

			<Card>
				<Table>
					<TableHead>
						<TableRow>
							<TableHeaderCell>Credential Name</TableHeaderCell>
							<TableHeaderCell>Provider</TableHeaderCell>
							<TableHeaderCell>Actions</TableHeaderCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{!credentialList || credentialList.length === 0 ? (
							<TableRow>
								<TableCell colSpan={4} className="text-center py-4 text-gray-500">
									No credentials configured
								</TableCell>
							</TableRow>
						) : (
							credentialList.map((credential: CredentialItem, index: number) => (
								<TableRow key={credential.credential_name || index}>
									<TableCell>
										<button
											type="button"
											className="text-left text-blue-600 hover:text-blue-800 hover:underline"
											onClick={() => setCredentialDetails(credential)}
										>
											{credential.credential_name}
										</button>
									</TableCell>
									<TableCell>
										{renderProviderBadge((credential.credential_info?.custom_llm_provider as string) || "-")}
									</TableCell>
									<TableCell>
										<Button
											icon={PencilAltIcon}
											variant="light"
											size="sm"
											aria-label={`Edit credential ${credential.credential_name}`}
											onClick={() => {
												setSelectedCredential(credential);
												setIsUpdateModalOpen(true);
											}}
										/>
										<Button
											icon={TrashIcon}
											variant="light"
											size="sm"
											aria-label={`Delete credential ${credential.credential_name}`}
											onClick={() => openDeleteModal(credential)}
											className="ml-2"
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</Card>

			<ResourceDetailsDrawer
				open={credentialDetails !== null}
				onClose={() => setCredentialDetails(null)}
				title={credentialDetails?.credential_name ?? "Credential details"}
				actions={
					credentialDetails && (
						<>
							<Button
								variant="secondary"
								onClick={() => {
									setSelectedCredential(credentialDetails);
									setIsUpdateModalOpen(true);
								}}
							>
								Edit
							</Button>
							<Button color="red" variant="secondary" onClick={() => openDeleteModal(credentialDetails)}>
								Delete
							</Button>
						</>
					)
				}
			>
				<Descriptions column={1} size="small" colon={false}>
					<Descriptions.Item label="Name">{credentialDetails?.credential_name ?? "—"}</Descriptions.Item>
					<Descriptions.Item label="Provider">
						{credentialDetails?.credential_info?.custom_llm_provider ?? "—"}
					</Descriptions.Item>
					{Object.entries(credentialDetails?.credential_info ?? {})
						.filter(
							([key, value]) =>
								key !== "custom_llm_provider" &&
								!/(?:key|token|secret|credential|password)/i.test(key) &&
								["string", "number", "boolean"].includes(typeof value),
						)
						.map(([key, value]) => (
							<Descriptions.Item key={key} label={key}>
								{String(value)}
							</Descriptions.Item>
						))}
				</Descriptions>
				<div className="mt-6">
					<Text className="font-medium">Configured fields</Text>
					<div className="mt-2 flex flex-wrap gap-2">
						{Object.keys(credentialDetails?.credential_values ?? {}).map((fieldName) => (
							<Badge key={fieldName} color="gray" size="xs">
								{fieldName}
							</Badge>
						))}
					</div>
				</div>
			</ResourceDetailsDrawer>

			{isAddModalOpen && (
				<AddCredentialsTab
					onAddCredential={handleAddCredential}
					open={isAddModalOpen}
					onCancel={() => setIsAddModalOpen(false)}
					uploadProps={uploadProps}
				/>
			)}
			{isUpdateModalOpen && (
				<EditCredentialsModal
					open={isUpdateModalOpen}
					existingCredential={selectedCredential}
					onUpdateCredential={handleUpdateCredential}
					uploadProps={uploadProps}
					onCancel={() => setIsUpdateModalOpen(false)}
				/>
			)}

			<DeleteResourceModal
				isOpen={isDeleteModalOpen}
				onCancel={closeDeleteModal}
				onOk={handleDeleteCredential}
				title="Delete Credential?"
				message="Are you sure you want to delete this credential? This action cannot be undone and may break existing integrations."
				resourceInformationTitle="Credential Information"
				resourceInformation={[
					{ label: "Credential Name", value: credentialToDelete?.credential_name },
					{ label: "Provider", value: credentialToDelete?.credential_info?.custom_llm_provider || "-" },
				]}
				confirmLoading={isCredentialDeleting}
				requiredConfirmation={credentialToDelete?.credential_name}
			/>
		</div>
	);
};

export default CredentialsPanel;
