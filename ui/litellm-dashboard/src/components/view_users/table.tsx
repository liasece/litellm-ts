import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";
import UserInfoView from "./user_info_view";
import { columns as createColumns } from "./columns";
import type { UserFilterState, UserInfo } from "./types";
import UserTableContent from "./table/UserTableContent";
import UserTableFilters from "./table/UserTableFilters";
import UserTablePagination from "./table/UserTablePagination";

interface UserListResponse {
  users: UserInfo[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface UserDataTableProps {
  data: UserInfo[];
  columns: ColumnDef<UserInfo, any>[];
  isLoading?: boolean;
  onSortChange?: (sortBy: string, sortOrder: "asc" | "desc") => void;
  currentSort?: {
    sortBy: string;
    sortOrder: "asc" | "desc";
  };
  accessToken: string | null;
  userRole: string | null;
  possibleUIRoles: Record<string, Record<string, string>> | null;
  handleEdit: (user: UserInfo) => void;
  handleDelete: (user: UserInfo) => void;
  handleResetPassword: (userId: string) => void;
  selectedUsers?: UserInfo[];
  onSelectionChange?: (selectedUsers: UserInfo[]) => void;
  enableSelection?: boolean;
  filters: UserFilterState;
  updateFilters: (update: Partial<UserFilterState>) => void;
  initialFilters: UserFilterState;
  teams: Array<{ team_id: string; team_alias?: string | null }> | null;
  userListResponse?: UserListResponse;
  currentPage: number;
  handlePageChange: (newPage: number) => void;
}

export function UserDataTable({
  data = [],
  columns: originalColumns,
  isLoading = false,
  onSortChange,
  currentSort,
  accessToken,
  userRole,
  possibleUIRoles,
  handleEdit,
  handleDelete,
  handleResetPassword,
  selectedUsers = [],
  onSelectionChange,
  enableSelection = false,
  filters,
  updateFilters,
  initialFilters,
  teams,
  userListResponse,
  currentPage,
  handlePageChange,
}: UserDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    {
      id: currentSort?.sortBy || "created_at",
      desc: currentSort?.sortOrder === "desc",
    },
  ]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const handleUserClick = useCallback((userId: string, edit = false) => {
    setSelectedUserId(userId);
    setOpenInEditMode(edit);
  }, []);

  const handleSelectUser = useCallback(
    (user: UserInfo, selected: boolean) => {
      if (!onSelectionChange) return;
      onSelectionChange(
        selected
          ? [...selectedUsers, user]
          : selectedUsers.filter((selectedUser) => selectedUser.user_id !== user.user_id),
      );
    },
    [onSelectionChange, selectedUsers],
  );

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      onSelectionChange?.(selected ? data : []);
    },
    [data, onSelectionChange],
  );

  const isUserSelected = useCallback(
    (user: UserInfo) => selectedUsers.some((selectedUser) => selectedUser.user_id === user.user_id),
    [selectedUsers],
  );

  const isAllSelected = data.length > 0 && selectedUsers.length === data.length;
  const isIndeterminate = selectedUsers.length > 0 && selectedUsers.length < data.length;

  const columns = useMemo(() => {
    if (!possibleUIRoles) return originalColumns;

    return createColumns(
      possibleUIRoles,
      handleEdit,
      handleDelete,
      handleResetPassword,
      handleUserClick,
      enableSelection
        ? {
            selectedUsers,
            onSelectUser: handleSelectUser,
            onSelectAll: handleSelectAll,
            isUserSelected,
            isAllSelected,
            isIndeterminate,
          }
        : undefined,
    );
  }, [
    enableSelection,
    handleDelete,
    handleEdit,
    handleResetPassword,
    handleSelectAll,
    handleSelectUser,
    handleUserClick,
    isAllSelected,
    isIndeterminate,
    isUserSelected,
    originalColumns,
    possibleUIRoles,
    selectedUsers,
  ]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const nextSorting = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(nextSorting);
      const primarySort = nextSorting[0];
      onSortChange?.(primarySort?.id || "created_at", primarySort?.desc === false ? "asc" : "desc");
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSorting: true,
  });

  useEffect(() => {
    if (!currentSort) return;
    setSorting([{ id: currentSort.sortBy, desc: currentSort.sortOrder === "desc" }]);
  }, [currentSort]);

  return (
    <>
      <div className="rounded-lg bg-white shadow">
        <div className="space-y-4 border-b px-6 py-4">
          <UserTableFilters
            filters={filters}
            initialFilters={initialFilters}
            possibleUIRoles={possibleUIRoles}
            teams={teams}
            expanded={showFilters}
            onExpandedChange={setShowFilters}
            onChange={updateFilters}
          />
          <UserTablePagination
            loading={isLoading}
            response={userListResponse}
            currentPage={currentPage}
            onPageChange={handlePageChange}
          />
        </div>
        <UserTableContent
          table={table}
          columnCount={columns.length}
          loading={isLoading}
          onUserClick={(userId) => handleUserClick(userId)}
        />
      </div>

      {selectedUserId && (
        <UserInfoView
          userId={selectedUserId}
          onClose={() => {
            setSelectedUserId(null);
            setOpenInEditMode(false);
          }}
          accessToken={accessToken}
          userRole={userRole}
          possibleUIRoles={possibleUIRoles}
          initialTab={openInEditMode ? 1 : 0}
          startInEditMode={openInEditMode}
        />
      )}
    </>
  );
}
