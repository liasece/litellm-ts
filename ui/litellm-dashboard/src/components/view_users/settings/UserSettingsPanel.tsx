import { rolesWithWriteAccess } from "@/utils/roles";
import { Button, Card, Title } from "@tremor/react";
import type { UserInfoV2Response } from "../../networking";
import { UserEditView } from "../../user_edit_view";
import type { TeamDisplayInfo } from "../types";
import UserSettingsSummary from "./UserSettingsSummary";

interface UserSettingsPanelProps {
  user: UserInfoV2Response;
  teams: TeamDisplayInfo[];
  accessToken: string | null;
  userRole: string | null;
  userModels: string[];
  possibleUIRoles: Record<string, Record<string, string>> | null;
  editing: boolean;
  userIdCopied: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSubmit: (values: Record<string, any>) => void;
  onCopyUserId: () => void;
}

function toUserEditData(user: UserInfoV2Response) {
  return {
    user_id: user.user_id,
    user_info: {
      user_email: user.user_email,
      user_alias: user.user_alias,
      user_role: user.user_role,
      models: user.models,
      max_budget: user.max_budget,
      budget_duration: user.budget_duration,
      metadata: user.metadata,
    },
  };
}

export default function UserSettingsPanel({
  user,
  teams,
  accessToken,
  userRole,
  userModels,
  possibleUIRoles,
  editing,
  userIdCopied,
  onEdit,
  onCancelEdit,
  onSubmit,
  onCopyUserId,
}: UserSettingsPanelProps) {
  const canEdit = Boolean(userRole && rolesWithWriteAccess.includes(userRole));

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <Title>User Settings</Title>
        {!editing && canEdit && <Button onClick={onEdit}>Edit Settings</Button>}
      </div>
      {editing ? (
        <UserEditView
          userData={toUserEditData(user)}
          onCancel={onCancelEdit}
          onSubmit={onSubmit}
          teams={teams}
          accessToken={accessToken}
          userID={user.user_id}
          userRole={userRole}
          userModels={userModels}
          possibleUIRoles={possibleUIRoles}
        />
      ) : (
        <UserSettingsSummary user={user} userIdCopied={userIdCopied} onCopyUserId={onCopyUserId} />
      )}
    </Card>
  );
}
