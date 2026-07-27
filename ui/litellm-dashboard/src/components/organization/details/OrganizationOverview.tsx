import type { Organization } from "@/components/networking";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { Badge, Card, Grid, Text, Title } from "@tremor/react";
import ObjectPermissionsView from "../../object_permissions_view";

interface OrganizationOverviewProps {
	organization: Organization;
	teamAliasMap: Record<string, string>;
	accessToken: string | null;
}

export default function OrganizationOverview({
	organization,
	teamAliasMap,
	accessToken,
}: OrganizationOverviewProps) {
	const budget = organization.litellm_budget_table;

	return (
		<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
			<Card>
				<Text>Organization Details</Text>
				<div className="mt-2">
					<Text>Created: {new Date(organization.created_at).toLocaleDateString()}</Text>
					<Text>Updated: {new Date(organization.updated_at).toLocaleDateString()}</Text>
					<Text>Created By: {organization.created_by}</Text>
				</div>
			</Card>
			<Card>
				<Text>Budget Status</Text>
				<div className="mt-2">
					<Title>${formatNumberWithCommas(organization.spend, 4)}</Title>
					<Text>
						of{" "}
						{budget.max_budget === null
							? "Unlimited"
							: `$${formatNumberWithCommas(budget.max_budget, 4)}`}
					</Text>
					{budget.budget_duration && (
						<Text className="text-gray-500">Reset: {budget.budget_duration}</Text>
					)}
				</div>
			</Card>
			<Card>
				<Text>Rate Limits</Text>
				<div className="mt-2">
					<Text>TPM: {budget.tpm_limit || "Unlimited"}</Text>
					<Text>RPM: {budget.rpm_limit || "Unlimited"}</Text>
					{budget.max_parallel_requests && (
						<Text>Max Parallel Requests: {budget.max_parallel_requests}</Text>
					)}
				</div>
			</Card>
			<Card>
				<Text>Models</Text>
				<div className="mt-2 flex flex-wrap gap-2">
					{organization.models.length === 0 ? (
						<Badge color="red">All proxy models</Badge>
					) : (
						organization.models.map((model) => (
							<Badge key={model} color="red">
								{model}
							</Badge>
						))
					)}
				</div>
			</Card>
			<Card>
				<Text>Teams</Text>
				<div className="mt-2 flex flex-wrap gap-2">
					{organization.teams?.map((team) => (
						<Badge key={team.team_id} color="red">
							{teamAliasMap[team.team_id] || team.team_id}
						</Badge>
					))}
				</div>
			</Card>
			<ObjectPermissionsView
				objectPermission={organization.object_permission}
				variant="card"
				accessToken={accessToken}
			/>
		</Grid>
	);
}

