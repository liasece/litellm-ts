import { Popover, Typography } from "antd";
import DefaultProxyAdminTag from "../../common_components/DefaultProxyAdminTag";

interface VirtualKeyUserCellProps {
	userId: string | null;
	userAlias?: string | null;
	userEmail?: string | null;
}

export default function VirtualKeyUserCell({ userId, userAlias, userEmail }: VirtualKeyUserCellProps) {
	if (!userId && !userAlias && !userEmail) return <>-</>;

	const displayValue = userAlias || userEmail || userId;
	const popoverContent = (
		<div className="flex min-w-[200px] max-w-[300px] flex-col gap-2 text-xs">
			{[
				{ label: "User Alias", value: userAlias },
				{ label: "User Email", value: userEmail },
				{ label: "User ID", value: userId },
			].map(({ label, value }) => (
				<div key={label} className="flex min-w-0 flex-col">
					<span className="text-gray-400">{label}</span>
					{value ? (
						<Typography.Text className="font-mono text-xs" ellipsis={{ tooltip: value }} copyable>
							{value}
						</Typography.Text>
					) : (
						<span className="font-mono">-</span>
					)}
				</div>
			))}
		</div>
	);

	return (
		<Popover content={popoverContent} trigger="hover" placement="bottomLeft">
			<span className="block max-w-40 cursor-default truncate font-mono text-xs">
				{userId === "default_user_id" && !userAlias && !userEmail ? (
					<DefaultProxyAdminTag userId={userId} />
				) : (
					displayValue || "-"
				)}
			</span>
		</Popover>
	);
}
