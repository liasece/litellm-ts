import { Alert, Button, Drawer, Spin } from "antd";
import type { ReactNode } from "react";

interface ResourceDetailsDrawerProps {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	subtitle?: ReactNode;
	actions?: ReactNode;
	loading?: boolean;
	error?: ReactNode;
	onRetry?: () => void;
	children: ReactNode;
}

export default function ResourceDetailsDrawer({
	open,
	onClose,
	title,
	subtitle,
	actions,
	loading = false,
	error,
	onRetry,
	children,
}: ResourceDetailsDrawerProps) {
	return (
		<Drawer
			open={open}
			onClose={onClose}
			destroyOnHidden
			width="min(720px, 100vw)"
			title={
				<div className="flex min-w-0 items-center justify-between gap-3 pr-6">
					<div className="min-w-0">
						<div>{title}</div>
						{subtitle && <div className="truncate text-xs font-normal text-gray-500">{subtitle}</div>}
					</div>
					{actions && <div className="flex shrink-0 gap-2">{actions}</div>}
				</div>
			}
			aria-label={typeof title === "string" ? title : "Resource details"}
		>
			{loading ? (
				<div className="flex justify-center py-10" aria-live="polite">
					<Spin />
				</div>
			) : error ? (
				<Alert
					message={error}
					type="error"
					showIcon
					action={
						onRetry && (
							<Button type="link" onClick={onRetry}>
								Retry
							</Button>
						)
					}
				/>
			) : (
				children
			)}
		</Drawer>
	);
}
