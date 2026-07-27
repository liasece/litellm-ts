import type { Organization } from "@/components/networking";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { InfoCircleOutlined } from "@ant-design/icons";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { Button } from "@tremor/react";
import { Popover, Tooltip } from "antd";
import { useMemo } from "react";
import type { KeyResponse, Team } from "../../key_team_helpers/key_list";
import VirtualKeyModelsCell from "./VirtualKeyModelsCell";
import VirtualKeyUserCell from "./VirtualKeyUserCell";

interface UseVirtualKeyColumnsOptions {
	teams: Team[] | null;
	organizations: Organization[];
	onSelect: (key: KeyResponse) => void;
	scope?: "global" | "team";
}

export default function useVirtualKeyColumns({
	teams,
	organizations,
	onSelect,
	scope = "global",
}: UseVirtualKeyColumnsOptions): ColumnDef<KeyResponse>[] {
	return useMemo<ColumnDef<KeyResponse>[]>(
		() => [
			...(scope === "global"
				? [
						{
							id: "expander",
							header: () => null,
							size: 40,
							enableSorting: false,
							cell: ({ row }: CellContext<KeyResponse, unknown>) =>
								row.getCanExpand() ? (
									<button type="button" onClick={row.getToggleExpandedHandler()} className="cursor-pointer">
										{row.getIsExpanded() ? "▼" : "▶"}
									</button>
								) : null,
						},
					]
				: []),
			{
				id: "token",
				accessorKey: "token",
				header: "Key ID",
				size: 100,
				enableSorting: true,
				cell: (info) => {
					const value = info.getValue<string>();
					return (
						<Tooltip title={value}>
							<Button
								size="xs"
								variant="light"
								className="block truncate bg-blue-50 px-2 py-0.5 text-left font-mono text-xs font-normal text-blue-500 hover:bg-blue-100"
								style={{ maxWidth: info.cell.column.getSize() }}
								onClick={() => onSelect(info.row.original)}
							>
								{value ?? "-"}
							</Button>
						</Tooltip>
					);
				},
			},
			{
				id: "key_alias",
				accessorKey: "key_alias",
				header: "Key Alias",
				size: 150,
				enableSorting: true,
				cell: (info) => (
					<span className="block truncate font-mono text-xs" style={{ maxWidth: info.cell.column.getSize() }}>
						{info.getValue<string>() ?? "-"}
					</span>
				),
			},
			{
				id: "key_name",
				accessorKey: "key_name",
				header: "Secret Key",
				size: 120,
				enableSorting: false,
				cell: (info) => <span className="font-mono text-xs">{info.getValue<string>()}</span>,
			},
			...(scope === "global"
				? [
						{
							id: "team_alias",
							accessorKey: "team_id",
							header: "Team",
							size: 120,
							enableSorting: false,
							cell: (info: CellContext<KeyResponse, unknown>) => {
								const teamId = info.getValue() as string | null;
								const team = teams?.find((item) => item.team_id === teamId);
								return teamId ? team?.team_alias || teamId : "-";
							},
						},
					]
				: []),
			{
				id: "organization_alias",
				accessorKey: scope === "team" ? "organization_id" : "org_id",
				header: scope === "team" ? "Organization ID" : "Organization",
				size: 140,
				enableSorting: false,
				cell: (info) => {
					const organizationId = info.getValue<string | null>();
					if (scope === "team") return organizationId || "-";
					const organization = organizations.find((item) => item.organization_id === organizationId);
					return organizationId ? organization?.organization_alias || organizationId : "-";
				},
			},
			...(scope === "global"
				? [
						{
							id: "user",
							accessorKey: "user",
							header: () => (
								<span className="flex items-center gap-1">
									User
									<Popover
										content="Displays the first available value: User Alias, User Email, or User ID."
										trigger="hover"
									>
										<InfoCircleOutlined className="cursor-help text-xs text-gray-400" />
									</Popover>
								</span>
							),
							size: 160,
							enableSorting: false,
							cell: ({ row }: CellContext<KeyResponse, unknown>) => (
								<VirtualKeyUserCell
									userId={row.original.user_id ?? null}
									userAlias={row.original.user?.user_alias}
									userEmail={row.original.user?.user_email ?? row.original.user_email}
								/>
							),
						},
					]
				: [
						{
							id: "user_email",
							accessorKey: "user",
							header: "User Email",
							size: 160,
							enableSorting: false,
							cell: ({ row }: CellContext<KeyResponse, unknown>) =>
								row.original.user?.user_email ?? row.original.user_email ?? "-",
						},
						{
							id: "user_id",
							accessorKey: "user_id",
							header: "User ID",
							size: 120,
							enableSorting: false,
							cell: ({ row }: CellContext<KeyResponse, unknown>) => (
								<VirtualKeyUserCell userId={row.original.user_id ?? null} />
							),
						},
					]),
			{
				id: "created_at",
				accessorKey: "created_at",
				header: "Created At",
				size: 120,
				enableSorting: true,
				cell: (info) => {
					const value = info.getValue<string | null>();
					return value ? new Date(value).toLocaleDateString() : "-";
				},
			},
			{
				id: "created_by",
				accessorKey: "created_by",
				header: "Created By",
				size: 160,
				enableSorting: false,
				cell: ({ row }) => (
					<VirtualKeyUserCell
						userId={row.original.created_by ?? null}
						userAlias={row.original.created_by_user?.user_alias}
						userEmail={row.original.created_by_user?.user_email}
					/>
				),
			},
			{
				id: "updated_at",
				accessorKey: "updated_at",
				header: "Updated At",
				size: 120,
				enableSorting: true,
				cell: (info) => {
					const value = info.getValue<string | null>();
					return value ? new Date(value).toLocaleDateString() : "Never";
				},
			},
			{
				id: "last_active",
				accessorKey: "last_active",
				header: () => (
					<span className="flex items-center gap-1">
						Last Active
						<Popover
							content="This is a new field and is not backfilled. Only new key usage will update this value."
							trigger="hover"
						>
							<InfoCircleOutlined className="cursor-help text-xs text-gray-400" />
						</Popover>
					</span>
				),
				size: 130,
				enableSorting: false,
				cell: (info) => {
					const value = info.getValue<string | null>();
					if (!value) return "Unknown";
					const date = new Date(value);
					return (
						<Tooltip
							title={date.toLocaleString(undefined, {
								dateStyle: "medium",
								timeStyle: "long",
							})}
						>
							<span>{date.toLocaleDateString()}</span>
						</Tooltip>
					);
				},
			},
			{
				id: "expires",
				accessorKey: "expires",
				header: "Expires",
				size: 120,
				enableSorting: false,
				cell: (info) => {
					const value = info.getValue<string | null>();
					return value ? new Date(value).toLocaleDateString() : "Never";
				},
			},
			{
				id: "spend",
				accessorKey: "spend",
				header: "Spend (USD)",
				size: 100,
				enableSorting: true,
				cell: (info) => formatNumberWithCommas(info.getValue<number>(), 4),
			},
			{
				id: "max_budget",
				accessorKey: "max_budget",
				header: "Budget (USD)",
				size: 110,
				enableSorting: true,
				cell: (info) => {
					const budget = info.getValue<number | null>();
					return budget === null ? "Unlimited" : `$${formatNumberWithCommas(budget)}`;
				},
			},
			{
				id: "budget_reset_at",
				accessorKey: "budget_reset_at",
				header: "Budget Reset",
				size: 130,
				enableSorting: false,
				cell: (info) => {
					const value = info.getValue<string | null>();
					return value ? new Date(value).toLocaleString() : "Never";
				},
			},
			{
				id: "models",
				accessorKey: "models",
				header: "Models",
				size: 200,
				enableSorting: false,
				cell: (info) => <VirtualKeyModelsCell models={info.getValue<string[]>()} />,
			},
			{
				id: "rate_limits",
				header: "Rate Limits",
				size: 140,
				enableSorting: false,
				cell: ({ row }) => (
					<div>
						<div>TPM: {row.original.tpm_limit ?? "Unlimited"}</div>
						<div>RPM: {row.original.rpm_limit ?? "Unlimited"}</div>
					</div>
				),
			},
		],
		[onSelect, organizations, scope, teams],
	);
}
