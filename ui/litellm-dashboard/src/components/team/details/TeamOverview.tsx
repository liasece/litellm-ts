import { formatNumberWithCommas } from "@/utils/dataUtils";
import { Badge, Card, Grid, Text, Title } from "@tremor/react";
import LoggingSettingsView from "../../logging_settings_view";
import ObjectPermissionsView from "../../object_permissions_view";
import type { TeamData } from "../types";

interface TeamOverviewProps {
	teamData: TeamData;
	accessToken: string | null;
	policyGuardrails: Record<string, string[]>;
	loadingPolicies: boolean;
}

function BadgeList({
	values,
	emptyLabel,
	color,
}: {
	values?: string[];
	emptyLabel: string;
	color: "blue" | "purple" | "red";
}) {
	if (!values?.length) return <Text className="text-gray-500">{emptyLabel}</Text>;
	return (
		<div className="flex flex-wrap gap-2">
			{values.map((value) => (
				<Badge key={value} color={color}>
					{value}
				</Badge>
			))}
		</div>
	);
}

export default function TeamOverview({
	teamData,
	accessToken,
	policyGuardrails,
	loadingPolicies,
}: TeamOverviewProps) {
	const info = teamData.team_info;

	return (
		<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
			<Card>
				<Text>Budget Status</Text>
				<div className="mt-2">
					<Title>${formatNumberWithCommas(info.spend, 4)}</Title>
					<Text>of {info.max_budget === null ? "Unlimited" : `$${formatNumberWithCommas(info.max_budget, 4)}`}</Text>
					{info.budget_duration && <Text className="text-gray-500">Reset: {info.budget_duration}</Text>}
					{info.team_member_budget_table && (
						<Text className="mt-2 text-gray-500">
							Team Member Budget: ${formatNumberWithCommas(info.team_member_budget_table.max_budget, 4)}
						</Text>
					)}
				</div>
			</Card>
			<Card>
				<Text>Rate Limits</Text>
				<div className="mt-2">
					<Text>TPM: {info.tpm_limit || "Unlimited"}</Text>
					<Text>RPM: {info.rpm_limit || "Unlimited"}</Text>
					{info.max_parallel_requests && <Text>Max Parallel Requests: {info.max_parallel_requests}</Text>}
				</div>
			</Card>
			<Card>
				<Text>Models</Text>
				<div className="mt-2">
					{info.models.length === 0 ? (
						<Badge color="red">All proxy models</Badge>
					) : (
						<BadgeList values={info.models} emptyLabel="No models configured" color="red" />
					)}
				</div>
			</Card>
			<Card>
				<Text className="font-semibold text-gray-900">Virtual Keys</Text>
				<div className="mt-2">
					<Text>User Keys: {teamData.keys.filter((key) => key.user_id).length}</Text>
					<Text>Service Account Keys: {teamData.keys.filter((key) => !key.user_id).length}</Text>
					<Text className="text-gray-500">Total: {teamData.keys.length}</Text>
				</div>
			</Card>
			<ObjectPermissionsView objectPermission={info.object_permission} variant="card" accessToken={accessToken} />
			<Card>
				<Text className="mb-3 font-semibold text-gray-900">Guardrails</Text>
				<BadgeList values={info.guardrails} emptyLabel="No guardrails configured" color="blue" />
				{info.metadata?.disable_global_guardrails && (
					<div className="mt-3 border-t border-gray-200 pt-3">
						<Badge color="yellow">Global Guardrails Disabled</Badge>
					</div>
				)}
			</Card>
			<Card>
				<Text className="mb-3 font-semibold text-gray-900">Policies</Text>
				{info.policies?.length ? (
					<div className="space-y-4">
						{info.policies.map((policy) => (
							<div key={policy} className="space-y-2">
								<div className="flex items-center gap-2">
									<Badge color="purple">{policy}</Badge>
									{loadingPolicies && <Text className="text-xs text-gray-400">Loading guardrails...</Text>}
								</div>
								{!loadingPolicies && policyGuardrails[policy]?.length > 0 && (
									<div className="ml-4 border-l-2 border-gray-200 pl-3">
										<Text className="mb-1 text-xs text-gray-500">Resolved Guardrails:</Text>
										<BadgeList
											values={policyGuardrails[policy]}
											emptyLabel="No resolved guardrails"
											color="blue"
										/>
									</div>
								)}
							</div>
						))}
					</div>
				) : (
					<Text className="text-gray-500">No policies configured</Text>
				)}
			</Card>
			<LoggingSettingsView loggingConfigs={info.metadata?.logging || []} disabledCallbacks={[]} variant="card" />
		</Grid>
	);
}
