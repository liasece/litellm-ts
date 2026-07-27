import { Button, Skeleton } from "antd";
import { CreateUserButton } from "../CreateUserButton";

interface UserListToolbarProps {
  loading: boolean;
  userId: string | null;
  accessToken: string | null;
  teams: any[] | null;
  possibleUIRoles: Record<string, Record<string, string>>;
  canBulkEdit: boolean;
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelection: () => void;
  onBulkEdit: () => void;
}

export default function UserListToolbar({
  loading,
  userId,
  accessToken,
  teams,
  possibleUIRoles,
  canBulkEdit,
  selectionMode,
  selectedCount,
  onToggleSelection,
  onBulkEdit,
}: UserListToolbarProps) {
  if (loading) {
    return (
      <div className="flex space-x-3">
        <Skeleton.Button active size="default" shape="default" style={{ width: 110, height: 36 }} />
        <Skeleton.Button active size="default" shape="default" style={{ width: 145, height: 36 }} />
        <Skeleton.Button active size="default" shape="default" style={{ width: 110, height: 36 }} />
      </div>
    );
  }

  if (!userId || !accessToken) return null;

  return (
    <div className="flex space-x-3">
      <CreateUserButton userID={userId} accessToken={accessToken} teams={teams} possibleUIRoles={possibleUIRoles} />
      {canBulkEdit && (
        <Button onClick={onToggleSelection} type={selectionMode ? "primary" : "default"} className="flex items-center">
          {selectionMode ? "Cancel Selection" : "Select Users"}
        </Button>
      )}
      {canBulkEdit && selectionMode && (
        <Button type="primary" onClick={onBulkEdit} disabled={selectedCount === 0} className="flex items-center">
          Bulk Edit ({selectedCount} selected)
        </Button>
      )}
    </div>
  );
}
