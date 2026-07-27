import { ArrowLeftIcon, RefreshIcon, TrashIcon } from "@heroicons/react/outline";
import { Button, Text, Title } from "@tremor/react";
import { Button as AntdButton } from "antd";
import { CheckIcon, CopyIcon } from "lucide-react";

interface UserDetailsHeaderProps {
  email: string | null;
  userId: string;
  canManage: boolean;
  copied: boolean;
  onBack: () => void;
  onCopyUserId: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
}

export default function UserDetailsHeader({
  email,
  userId,
  canManage,
  copied,
  onBack,
  onCopyUserId,
  onResetPassword,
  onDelete,
}: UserDetailsHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <Button icon={ArrowLeftIcon} variant="light" onClick={onBack} className="mb-4">
          Back to Users
        </Button>
        <Title>{email || "User"}</Title>
        <div className="flex cursor-pointer items-center">
          <Text className="font-mono text-gray-500">{userId}</Text>
          <AntdButton
            type="text"
            size="small"
            icon={copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            onClick={onCopyUserId}
            className={`left-2 z-10 transition-all duration-200 ${
              copied
                ? "border-green-200 bg-green-50 text-green-600"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            }`}
          />
        </div>
      </div>
      {canManage && (
        <div className="flex items-center space-x-2">
          <Button icon={RefreshIcon} variant="secondary" onClick={onResetPassword} className="flex items-center">
            Reset Password
          </Button>
          <Button
            icon={TrashIcon}
            variant="secondary"
            onClick={onDelete}
            className="flex items-center border-red-500 text-red-500 hover:border-red-600 hover:text-red-600"
          >
            Delete User
          </Button>
        </div>
      )}
    </div>
  );
}
