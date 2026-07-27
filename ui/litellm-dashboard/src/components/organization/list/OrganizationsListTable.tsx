import type { Organization } from "../../networking";
import TableIconActionButton from "../../common_components/IconActionButton/TableIconActionButtons/TableIconActionButton";
import { formatNumberWithCommas } from "../../../utils/dataUtils";
import { Button, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Text } from "@tremor/react";
import { Tooltip } from "antd";
import OrganizationModelsCell from "./OrganizationModelsCell";

interface OrganizationsListTableProps {
	organizations: Organization[];
	canManage: boolean;
	onOpen: (organizationId: string, edit: boolean) => void;
	onDelete: (organizationId: string) => void;
}

export default function OrganizationsListTable({
	organizations,
	canManage,
	onOpen,
	onDelete,
}: OrganizationsListTableProps) {
	const sortedOrganizations = [...organizations].sort(
		(first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
	);

	return (
		<Table>
			<TableHead>
				<TableRow>
					<TableHeaderCell>Organization ID</TableHeaderCell>
					<TableHeaderCell>Organization Name</TableHeaderCell>
					<TableHeaderCell>Created</TableHeaderCell>
					<TableHeaderCell>Spend (USD)</TableHeaderCell>
					<TableHeaderCell>Budget (USD)</TableHeaderCell>
					<TableHeaderCell>Models</TableHeaderCell>
					<TableHeaderCell>TPM / RPM Limits</TableHeaderCell>
					<TableHeaderCell>Info</TableHeaderCell>
					<TableHeaderCell>Actions</TableHeaderCell>
				</TableRow>
			</TableHead>
			<TableBody>
				{sortedOrganizations.map((organization) => (
					<TableRow key={organization.organization_id}>
						<TableCell>
							<Tooltip title={organization.organization_id}>
								<Button
									size="xs"
									variant="light"
									className="max-w-[200px] truncate bg-blue-50 px-2 py-0.5 text-left font-mono text-xs font-normal text-blue-500 hover:bg-blue-100"
									onClick={() => onOpen(organization.organization_id, false)}
								>
									{organization.organization_id.slice(0, 7)}...
								</Button>
							</Tooltip>
						</TableCell>
						<TableCell>{organization.organization_alias}</TableCell>
						<TableCell>
							{organization.created_at ? new Date(organization.created_at).toLocaleDateString() : "N/A"}
						</TableCell>
						<TableCell>{formatNumberWithCommas(organization.spend, 4)}</TableCell>
						<TableCell>{organization.litellm_budget_table?.max_budget ?? "No limit"}</TableCell>
						<TableCell className={organization.models.length > 3 ? "px-0" : ""}>
							<OrganizationModelsCell models={organization.models} />
						</TableCell>
						<TableCell>
							<Text>
								TPM: {organization.litellm_budget_table?.tpm_limit || "Unlimited"}
								<br />
								RPM: {organization.litellm_budget_table?.rpm_limit || "Unlimited"}
							</Text>
						</TableCell>
						<TableCell>
							<Text>{organization.members?.length || 0} Members</Text>
						</TableCell>
						<TableCell>
							{canManage && (
								<>
									<TableIconActionButton
										variant="Edit"
										tooltipText="Edit organization"
										onClick={() => onOpen(organization.organization_id, true)}
									/>
									<TableIconActionButton
										variant="Delete"
										tooltipText="Delete organization"
										onClick={() => onDelete(organization.organization_id)}
									/>
								</>
							)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
