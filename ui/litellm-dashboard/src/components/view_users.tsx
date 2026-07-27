import { updateExistingKeys } from "@/utils/dataUtils";
import { isAdminRole, isProxyAdminRole } from "@/utils/roles";
import { useDebouncedState } from "@tanstack/react-pacer/debouncer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@tremor/react";
import { Skeleton } from "antd";
import { useEffect, useState } from "react";
import DefaultUserSettings from "./DefaultUserSettings";
import NotificationsManager from "./molecules/notifications_manager";
import {
	getPossibleUserRoles,
	getProxyBaseUrl,
	invitationCreateCall,
	modelAvailableCall,
	userDeleteCall,
	userListCall,
	type UserListResponse,
	userUpdateUserCall,
} from "./networking";
import type { InvitationLink } from "./onboarding_link";
import UserListToolbar from "./view_users/UserListToolbar";
import { columns } from "./view_users/columns";
import UserListDialogs from "./view_users/dialogs/UserListDialogs";
import { UserDataTable } from "./view_users/table";
import { initialUserFilters, type UserFilterState, type UserInfo } from "./view_users/types";

interface ViewUserDashboardProps {
	accessToken: string | null;
	token: string | null;
	keys: any[] | null;
	userRole: string | null;
	userID: string | null;
	teams: any[] | null;
	setKeys: React.Dispatch<React.SetStateAction<object[] | null>>;
	orgAdminOrgIds?: Array<{ organization_id: string; organization_alias: string }> | null;
}

interface UserEditValues extends Record<string, unknown> {
	user_id?: string;
}

const DEFAULT_PAGE_SIZE = 25;

export default function ViewUserDashboard({
	accessToken,
	token,
	userRole,
	userID,
	teams,
	orgAdminOrgIds,
}: ViewUserDashboardProps) {
	const isProxyAdmin = Boolean(userRole && isProxyAdminRole(userRole));
	const queryClient = useQueryClient();
	const [currentPage, setCurrentPage] = useState(1);
	const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
	const [editModalOpen, setEditModalOpen] = useState(false);
	const [userToDelete, setUserToDelete] = useState<UserInfo | null>(null);
	const [isDeletingUser, setIsDeletingUser] = useState(false);
	const [filters, setFilters] = useState<UserFilterState>(initialUserFilters);
	const [debouncedFilters, setDebouncedFilters, debouncer] = useDebouncedState(filters, { wait: 300 });
	const [invitationOpen, setInvitationOpen] = useState(false);
	const [invitationLink, setInvitationLink] = useState<InvitationLink | null>(null);
	const [baseUrl] = useState(getProxyBaseUrl);
	const [selectedUsers, setSelectedUsers] = useState<UserInfo[]>([]);
	const [bulkEditOpen, setBulkEditOpen] = useState(false);
	const [selectionMode, setSelectionMode] = useState(false);
	const [userModels, setUserModels] = useState<string[]>([]);

	useEffect(() => () => debouncer.cancel(), [debouncer]);
	useEffect(() => {
		const fetchUserModels = async () => {
			if (!userID || !userRole || !accessToken) return;

			try {
				const availableModels = await modelAvailableCall(accessToken, userID, userRole);
				setUserModels(availableModels.data.map((model: { id: string }) => model.id));
			} catch {
				NotificationsManager.fromBackend("Failed to load available user models");
			}
		};

		void fetchUserModels();
	}, [accessToken, userID, userRole]);

	const updateFilters = (update: Partial<UserFilterState>) => {
		setFilters((previousFilters) => {
			const nextFilters = { ...previousFilters, ...update };
			setDebouncedFilters(nextFilters);
			return nextFilters;
		});
		setCurrentPage(1);
	};

	const userListQuery = useQuery({
		queryKey: ["userList", { debouncedFilter: debouncedFilters, currentPage, orgAdminOrgIds }],
		queryFn: async () => {
			if (!accessToken) throw new Error("Access token required");
			return userListCall(
				accessToken,
				debouncedFilters.user_id ? [debouncedFilters.user_id] : null,
				currentPage,
				DEFAULT_PAGE_SIZE,
				debouncedFilters.email || null,
				debouncedFilters.user_role || null,
				debouncedFilters.team || null,
				debouncedFilters.sso_user_id || null,
				debouncedFilters.sort_by,
				debouncedFilters.sort_order,
				orgAdminOrgIds?.map((organization) => organization.organization_id) ?? null,
			);
		},
		enabled: Boolean(accessToken && token && userRole && userID),
		placeholderData: (previousData) => previousData,
	});

	const userRolesQuery = useQuery<Record<string, Record<string, string>>>({
		queryKey: ["userRoles"],
		initialData: {},
		queryFn: async () => {
			if (!accessToken) throw new Error("Access token required");
			return getPossibleUserRoles(accessToken);
		},
		enabled: Boolean(accessToken && token && userRole && userID),
	});
	const possibleUIRoles = userRolesQuery.data;

	const openEditModal = (user: UserInfo) => {
		setSelectedUser(user);
		setEditModalOpen(true);
	};

	const handleResetPassword = async (userId: string) => {
		if (!accessToken) {
			NotificationsManager.fromBackend("Access token not found");
			return;
		}

		try {
			NotificationsManager.success("Generating password reset link...");
			setInvitationLink(await invitationCreateCall(accessToken, userId));
			setInvitationOpen(true);
		} catch {
			NotificationsManager.fromBackend("Failed to generate password reset link");
		}
	};

	const confirmDelete = async () => {
		if (!userToDelete || !accessToken) return;

		try {
			setIsDeletingUser(true);
			await userDeleteCall(accessToken, [userToDelete.user_id]);
			queryClient.setQueriesData<UserListResponse>({ queryKey: ["userList"] }, (previousData) => {
				if (!previousData) return previousData;
				return {
					...previousData,
					users: previousData.users.filter((user) => user.user_id !== userToDelete.user_id),
				};
			});
			NotificationsManager.success("User deleted successfully");
		} catch {
			NotificationsManager.fromBackend("Failed to delete user");
		} finally {
			setUserToDelete(null);
			setIsDeletingUser(false);
		}
	};

	const handleEditSubmit = async (editedUser: UserEditValues) => {
		if (!accessToken || !token || !userRole || !userID) return;

		try {
			const response = await userUpdateUserCall(accessToken, editedUser, null);
			queryClient.setQueriesData<UserListResponse>({ queryKey: ["userList"] }, (previousData) => {
				if (!previousData) return previousData;
				return {
					...previousData,
					users: previousData.users.map((user) =>
						user.user_id === response.data.user_id ? updateExistingKeys(user, response.data) : user,
					),
				};
			});
			NotificationsManager.success(`User ${editedUser.user_id} updated successfully`);
		} catch {
			NotificationsManager.fromBackend("Failed to update user");
		} finally {
			setSelectedUser(null);
			setEditModalOpen(false);
		}
	};

	const handleBulkEdit = () => {
		if (selectedUsers.length === 0) {
			NotificationsManager.fromBackend("Please select users to edit");
			return;
		}
		setBulkEditOpen(true);
	};

	const handleBulkEditSuccess = () => {
		void queryClient.invalidateQueries({ queryKey: ["userList"] });
		setSelectedUsers([]);
		setSelectionMode(false);
	};

	const tableColumns = columns(possibleUIRoles, openEditModal, setUserToDelete, handleResetPassword, () => {});

	const userTable = (
		<UserDataTable
			data={userListQuery.data?.users || []}
			columns={tableColumns}
			isLoading={userListQuery.isLoading}
			accessToken={accessToken}
			userRole={userRole}
			onSortChange={(sortBy, sortOrder) => updateFilters({ sort_by: sortBy, sort_order: sortOrder })}
			currentSort={{ sortBy: filters.sort_by, sortOrder: filters.sort_order }}
			possibleUIRoles={possibleUIRoles}
			handleEdit={openEditModal}
			handleDelete={setUserToDelete}
			handleResetPassword={handleResetPassword}
			enableSelection={isProxyAdmin && selectionMode}
			selectedUsers={isProxyAdmin ? selectedUsers : []}
			onSelectionChange={setSelectedUsers}
			filters={filters}
			updateFilters={updateFilters}
			initialFilters={initialUserFilters}
			teams={teams}
			userListResponse={userListQuery.data}
			currentPage={currentPage}
			handlePageChange={setCurrentPage}
		/>
	);

	return (
		<div className="w-full overflow-hidden p-8">
			<div className="mb-4 flex items-center justify-between">
				<UserListToolbar
					loading={userListQuery.isLoading}
					userId={userID}
					accessToken={accessToken}
					teams={teams}
					possibleUIRoles={possibleUIRoles}
					canBulkEdit={isProxyAdmin}
					selectionMode={selectionMode}
					selectedCount={selectedUsers.length}
					onToggleSelection={() => {
						setSelectionMode((enabled) => !enabled);
						setSelectedUsers([]);
					}}
					onBulkEdit={handleBulkEdit}
				/>
			</div>

			{isProxyAdmin ? (
				<TabGroup>
					<TabList className="mb-4">
						<Tab>Users</Tab>
						<Tab>Default User Settings</Tab>
					</TabList>
					<TabPanels>
						<TabPanel>{userTable}</TabPanel>
						<TabPanel>
							{!userID || !userRole || !accessToken ? (
								<div className="flex h-64 items-center justify-center">
									<Skeleton active paragraph={{ rows: 4 }} />
								</div>
							) : (
								<DefaultUserSettings
									accessToken={accessToken}
									possibleUIRoles={possibleUIRoles}
									userID={userID}
									userRole={userRole}
								/>
							)}
						</TabPanel>
					</TabPanels>
				</TabGroup>
			) : (
				userTable
			)}

			<UserListDialogs
				editOpen={editModalOpen}
				selectedUser={selectedUser}
				deleteOpen={Boolean(userToDelete)}
				deleting={isDeletingUser}
				userToDelete={userToDelete}
				invitationOpen={invitationOpen}
				invitationLink={invitationLink}
				baseUrl={baseUrl}
				bulkEditOpen={bulkEditOpen}
				selectedUsers={selectedUsers}
				possibleUIRoles={possibleUIRoles}
				accessToken={accessToken}
				teams={teams}
				userRole={userRole}
				userModels={userModels}
				allowAllUsers={Boolean(userRole && isAdminRole(userRole))}
				onEditCancel={() => {
					setSelectedUser(null);
					setEditModalOpen(false);
				}}
				onEditSubmit={handleEditSubmit}
				onDeleteCancel={() => setUserToDelete(null)}
				onDeleteConfirm={confirmDelete}
				onInvitationOpenChange={setInvitationOpen}
				onBulkEditCancel={() => setBulkEditOpen(false)}
				onBulkEditSuccess={handleBulkEditSuccess}
			/>
		</div>
	);
}
