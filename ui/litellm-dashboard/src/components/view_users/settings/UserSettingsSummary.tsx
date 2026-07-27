import { formatNumberWithCommas } from "@/utils/dataUtils";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button as AntdButton } from "antd";
import { Text } from "@tremor/react";
import type { UserInfoV2Response } from "../../networking";
import { getBudgetDurationLabel } from "../../common_components/budget_duration_dropdown";

interface UserSettingsSummaryProps {
  user: UserInfoV2Response;
  userIdCopied: boolean;
  onCopyUserId: () => void;
}

function UserSetting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text className="font-medium">{label}</Text>
      {children}
    </div>
  );
}

export default function UserSettingsSummary({
  user,
  userIdCopied,
  onCopyUserId,
}: UserSettingsSummaryProps) {
  return (
    <div className="space-y-4">
      <UserSetting label="User ID">
        <div className="flex cursor-pointer items-center">
          <Text className="font-mono">{user.user_id}</Text>
          <AntdButton
            type="text"
            size="small"
            icon={userIdCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            onClick={onCopyUserId}
            className={`left-2 z-10 transition-all duration-200 ${
              userIdCopied
                ? "border-green-200 bg-green-50 text-green-600"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}
          />
        </div>
      </UserSetting>
      <UserSetting label="Email">
        <Text>{user.user_email || "Not Set"}</Text>
      </UserSetting>
      <UserSetting label="User Alias">
        <Text>{user.user_alias || "Not Set"}</Text>
      </UserSetting>
      <UserSetting label="Global Proxy Role">
        <Text>{user.user_role || "Not Set"}</Text>
      </UserSetting>
      <UserSetting label="Created">
        <Text>{user.created_at ? new Date(user.created_at).toLocaleString() : "Unknown"}</Text>
      </UserSetting>
      <UserSetting label="Last Updated">
        <Text>{user.updated_at ? new Date(user.updated_at).toLocaleString() : "Unknown"}</Text>
      </UserSetting>
      <UserSetting label="Personal Models">
        <div className="mt-1 flex flex-wrap gap-2">
          {user.models?.length > 0 ? (
            user.models.map((model) => (
              <span key={model} className="rounded bg-blue-100 px-2 py-1 text-xs">
                {model}
              </span>
            ))
          ) : (
            <Text>All proxy models</Text>
          )}
        </div>
      </UserSetting>
      <UserSetting label="Max Budget">
        <Text>
          {user.max_budget !== null && user.max_budget !== undefined
            ? `$${formatNumberWithCommas(user.max_budget, 4)}`
            : "Unlimited"}
        </Text>
      </UserSetting>
      <UserSetting label="Budget Reset">
        <Text>{getBudgetDurationLabel(user.budget_duration ?? null)}</Text>
      </UserSetting>
      <UserSetting label="Metadata">
        <pre className="mt-1 overflow-auto rounded bg-gray-100 p-2 text-xs">
          {JSON.stringify(user.metadata || {}, null, 2)}
        </pre>
      </UserSetting>
    </div>
  );
}
