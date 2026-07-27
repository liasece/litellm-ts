import type { FilterState } from "@/app/(dashboard)/organizations/OrganizationFilters";
import { Button, Col, Grid, Text } from "@tremor/react";
import { Form } from "antd";
import { useState } from "react";
import DeleteResourceModal from "./common_components/DeleteResourceModal";
import NotificationsManager from "./molecules/notifications_manager";
import { type Organization, organizationCreateCall, organizationDeleteCall, organizationListCall } from "./networking";
import OrganizationInfoView from "./organization/organization_view";
import CreateOrganizationModal, { type CreateOrganizationValues } from "./organization/list/CreateOrganizationModal";
import OrganizationsListPanel from "./organization/list/OrganizationsListPanel";

interface OrganizationsTableProps {
	organizations: Organization[];
	userRole: string;
	userModels: string[];
	accessToken: string | null;
	lastRefreshed?: string;
	handleRefreshClick?: () => void;
	currentOrg?: unknown;
	guardrailsList?: string[];
	setOrganizations: (organizations: Organization[]) => void;
	premiumUser: boolean;
}

const initialFilters: FilterState = {
	org_id: "",
	org_alias: "",
	sort_by: "created_at",
	sort_order: "desc",
};

export const fetchOrganizations = async (
	accessToken: string,
	setOrganizations: (organizations: Organization[]) => void,
	orgId: string | null = null,
	orgAlias: string | null = null,
) => {
	const organizations = await organizationListCall(accessToken, orgId, orgAlias);
	setOrganizations(organizations);
};

export default function OrganizationsTable({
	organizations,
	userRole,
	userModels,
	accessToken,
	lastRefreshed,
	handleRefreshClick,
	setOrganizations,
	premiumUser,
}: OrganizationsTableProps) {
	const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
	const [editOrg, setEditOrg] = useState(false);
	const [orgToDelete, setOrgToDelete] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [createModalOpen, setCreateModalOpen] = useState(false);
	const [showFilters, setShowFilters] = useState(false);
	const [filters, setFilters] = useState<FilterState>(initialFilters);
	const [form] = Form.useForm<CreateOrganizationValues>();

	const refreshOrganizations = async (nextFilters: FilterState = filters) => {
		if (!accessToken) return;

		try {
			await fetchOrganizations(
				accessToken,
				setOrganizations,
				nextFilters.org_id || null,
				nextFilters.org_alias || null,
			);
		} catch {
			NotificationsManager.fromBackend("Failed to load organizations");
		}
	};

	const handleFilterChange = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
		const nextFilters = { ...filters, [key]: value };
		setFilters(nextFilters);
		void refreshOrganizations(nextFilters);
	};

	const handleFilterReset = () => {
		setFilters(initialFilters);
		void refreshOrganizations(initialFilters);
	};

	const handleOpenOrganization = (organizationId: string, edit: boolean) => {
		setSelectedOrgId(organizationId);
		setEditOrg(edit);
	};

	const confirmDelete = async () => {
		if (!orgToDelete || !accessToken) return;

		try {
			setIsDeleting(true);
			await organizationDeleteCall(accessToken, orgToDelete);
			NotificationsManager.success("Organization deleted successfully");
			setOrgToDelete(null);
			await refreshOrganizations();
		} catch {
			NotificationsManager.fromBackend("Failed to delete organization");
		} finally {
			setIsDeleting(false);
		}
	};

	const handleCreate = async (values: CreateOrganizationValues) => {
		if (!accessToken) return;

		try {
			await organizationCreateCall(accessToken, values);
			NotificationsManager.success("Organization created successfully");
			setCreateModalOpen(false);
			form.resetFields();
			await refreshOrganizations();
		} catch {
			NotificationsManager.fromBackend("Failed to create organization");
		}
	};

	const closeCreateModal = () => {
		setCreateModalOpen(false);
		form.resetFields();
	};

	if (!premiumUser) {
		return (
			<Text>
				This is a LiteLLM Enterprise feature, and requires a valid key to use. Get a trial key{" "}
				<a href="https://www.litellm.ai/#pricing" target="_blank" rel="noopener noreferrer">
					here
				</a>
				.
			</Text>
		);
	}

	return (
		<div className="mx-4 h-[75vh] w-full">
			<Grid numItems={1} className="mt-2 w-full gap-2 p-8">
				<Col numColSpan={1} className="flex flex-col gap-2">
					{(userRole === "Admin" || userRole === "Org Admin") && !selectedOrgId && (
						<Button className="w-fit" onClick={() => setCreateModalOpen(true)}>
							+ Create New Organization
						</Button>
					)}

					{selectedOrgId ? (
						<OrganizationInfoView
							organizationId={selectedOrgId}
							onClose={() => {
								setSelectedOrgId(null);
								setEditOrg(false);
							}}
							accessToken={accessToken}
							is_org_admin
							is_proxy_admin={userRole === "Admin"}
							userModels={userModels}
							editOrg={editOrg}
						/>
					) : (
						<OrganizationsListPanel
							organizations={organizations}
							filters={filters}
							showFilters={showFilters}
							lastRefreshed={lastRefreshed}
							canManage={userRole === "Admin"}
							onRefresh={handleRefreshClick}
							onToggleFilters={setShowFilters}
							onFilterChange={handleFilterChange}
							onFilterReset={handleFilterReset}
							onOpen={handleOpenOrganization}
							onDelete={setOrgToDelete}
						/>
					)}
				</Col>
			</Grid>

			{createModalOpen && (
				<CreateOrganizationModal
					open
					accessToken={accessToken}
					form={form}
					onCancel={closeCreateModal}
					onCreate={handleCreate}
				/>
			)}

			<DeleteResourceModal
				isOpen={Boolean(orgToDelete)}
				title="Delete Organization?"
				message="Are you sure you want to delete this organization? This action cannot be undone."
				resourceInformationTitle="Organization Information"
				resourceInformation={[{ label: "Organization ID", value: orgToDelete, code: true }]}
				onCancel={() => setOrgToDelete(null)}
				onOk={confirmDelete}
				confirmLoading={isDeleting}
			/>
		</div>
	);
}
