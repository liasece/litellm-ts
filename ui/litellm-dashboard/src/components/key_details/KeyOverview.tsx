import { formatNumberWithCommas } from "@/utils/dataUtils";
import { Badge, Card, Grid, Text, Title } from "@tremor/react";
import { mapInternalToDisplayNames } from "../callback_info_helpers";
import AutoRotationView from "../common_components/AutoRotationView";
import { extractLoggingSettings } from "../key_info_utils";
import type { KeyResponse } from "../key_team_helpers/key_list";
import LoggingSettingsView from "../logging_settings_view";
import ObjectPermissionsView from "../object_permissions_view";

interface KeyOverviewProps {
	keyData: KeyResponse;
	accessToken: string | null;
	policyGuardrails: Record<string, string[]>;
	loadingPolicies: boolean;
}

export default function KeyOverview({
	keyData,
	accessToken,
	policyGuardrails,
	loadingPolicies,
}: KeyOverviewProps) {
	const guardrails = Array.isArray(keyData.metadata?.guardrails) ? keyData.metadata.guardrails : [];
	const policies = Array.isArray(keyData.metadata?.policies) ? keyData.metadata.policies : [];

	return (
		<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
			<Card>
				<Text>Spend</Text>
				<div className="mt-2">
					<Title>${formatNumberWithCommas(keyData.spend, 4)}</Title>
					<Text>
						of {keyData.max_budget !== null ? `$${formatNumberWithCommas(keyData.max_budget)}` : "Unlimited"}
					</Text>
				</div>
			</Card>

			<Card>
				<Text>Rate Limits</Text>
				<div className="mt-2">
					<Text>TPM: {keyData.tpm_limit !== null ? keyData.tpm_limit : "Unlimited"}</Text>
					<Text>RPM: {keyData.rpm_limit !== null ? keyData.rpm_limit : "Unlimited"}</Text>
				</div>
			</Card>

			<Card>
				<Text>Models</Text>
				<div className="mt-2 flex flex-wrap gap-2">
					{keyData.models?.length > 0 ? (
						keyData.models.map((model) => (
							<Badge key={model} color="red">
								{model}
							</Badge>
						))
					) : (
						<Text>No models specified</Text>
					)}
				</div>
			</Card>

			<Card>
				<ObjectPermissionsView objectPermission={keyData.object_permission} variant="inline" accessToken={accessToken} />
			</Card>

			<Card>
				<Text className="mb-3 font-medium">Guardrails</Text>
				{guardrails.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{guardrails.map((guardrail) => (
							<Badge key={String(guardrail)} color="blue">
								{String(guardrail)}
							</Badge>
						))}
					</div>
				) : (
					<Text className="text-gray-500">No guardrails configured</Text>
				)}
				{keyData.metadata?.disable_global_guardrails === true && (
					<div className="mt-3 border-t border-gray-200 pt-3">
						<Badge color="yellow">Global Guardrails Disabled</Badge>
					</div>
				)}
			</Card>

			<Card>
				<Text className="mb-3 font-medium">Policies</Text>
				{policies.length > 0 ? (
					<div className="space-y-4">
						{policies.map((policyValue) => {
							const policy = String(policyValue);
							return (
								<div key={policy} className="space-y-2">
									<div className="flex items-center gap-2">
										<Badge color="purple">{policy}</Badge>
										{loadingPolicies && <Text className="text-xs text-gray-400">Loading guardrails...</Text>}
									</div>
									{!loadingPolicies && policyGuardrails[policy]?.length > 0 && (
										<div className="ml-4 border-l-2 border-gray-200 pl-3">
											<Text className="mb-1 text-xs text-gray-500">Resolved Guardrails:</Text>
											<div className="flex flex-wrap gap-1">
												{policyGuardrails[policy].map((guardrail) => (
													<Badge key={guardrail} color="blue" size="xs">
														{guardrail}
													</Badge>
												))}
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				) : (
					<Text className="text-gray-500">No policies configured</Text>
				)}
			</Card>

			<LoggingSettingsView
				loggingConfigs={extractLoggingSettings(keyData.metadata)}
				disabledCallbacks={
					Array.isArray(keyData.metadata?.litellm_disabled_callbacks)
						? mapInternalToDisplayNames(keyData.metadata.litellm_disabled_callbacks)
						: []
				}
				variant="card"
			/>

			<AutoRotationView
				autoRotate={keyData.auto_rotate}
				rotationInterval={keyData.rotation_interval}
				lastRotationAt={keyData.last_rotation_at}
				keyRotationAt={keyData.key_rotation_at}
				nextRotationAt={keyData.next_rotation_at}
				variant="card"
			/>
		</Grid>
	);
}
