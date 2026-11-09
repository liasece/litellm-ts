<script setup lang="ts">
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import PermissionSummaryComponent from "./PermissionSummaryComponent.vue";
import LoggingSummaryComponent from "./LoggingSummaryComponent.vue";
import { objectValue, stringList } from "../logic/ResourceDraftLogic";
import type { AccessCatalog, TeamDetail } from "../support/AccessModels";
defineProps<{ data: TeamDetail; catalog: AccessCatalog }>();
const money = useMoneyFormatter();
</script>
<template>
	<div class="access-overview-grid access-team-overview">
		<UiCard
			><p>Budget Status</p>
			<h3>{{ money(data.team_info.spend, 4) }}</h3>
			<p>of {{ data.team_info.max_budget == null ? "Unlimited" : money(data.team_info.max_budget, 4) }}</p>
			<p v-if="data.team_info.budget_duration" class="access-muted">Reset: {{ data.team_info.budget_duration }}</p>
			<p v-if="objectValue(data.team_info.team_member_budget_table).max_budget != null" class="access-muted">
				Team Member Budget: {{ money(Number(objectValue(data.team_info.team_member_budget_table).max_budget), 4) }}
			</p></UiCard
		><UiCard
			><p>Rate Limits</p>
			<div class="access-team-overview-values">
				<p>TPM: {{ data.team_info.tpm_limit || "Unlimited" }}</p>
				<p>RPM: {{ data.team_info.rpm_limit || "Unlimited" }}</p>
				<p v-if="data.team_info.max_parallel_requests">Max Parallel Requests: {{ data.team_info.max_parallel_requests }}</p>
			</div></UiCard
		><UiCard
			><p>Models</p>
			<div class="access-tags">
				<UiTag v-for="model in data.team_info.models" :key="model" appearance="tremor" color="red">{{ model }}</UiTag
				><UiTag v-if="!data.team_info.models.length" appearance="tremor" color="red">All proxy models</UiTag>
			</div></UiCard
		><UiCard
			><strong class="access-team-overview-title">Virtual Keys</strong>
			<p>User Keys: {{ data.keys.filter((key) => key.user_id).length }}</p>
			<p>Service Account Keys: {{ data.keys.filter((key) => !key.user_id).length }}</p>
			<p class="access-muted">Total: {{ data.keys.length }}</p></UiCard
		><PermissionSummaryComponent :permission="data.team_info.object_permission" /><UiCard
			><strong class="access-team-overview-title access-team-overview-title--spaced">Guardrails</strong>
			<div class="access-tags">
				<UiTag v-for="name in stringList(data.team_info.guardrails)" :key="name" appearance="tremor" color="blue">{{ name }}</UiTag>
				<p v-if="!stringList(data.team_info.guardrails).length" class="access-muted">No guardrails configured</p>
			</div>
			<UiTag v-if="data.team_info.metadata?.disable_global_guardrails" appearance="tremor" color="yellow"
				>Global Guardrails Disabled</UiTag
			></UiCard
		><UiCard
			><strong class="access-team-overview-title access-team-overview-title--spaced">Policies</strong>
			<div v-for="name in data.team_info.policies" :key="name" class="access-policy">
				<UiTag appearance="tremor" color="purple">{{ name }}</UiTag>
			</div>
			<p v-if="!data.team_info.policies?.length" class="access-muted">No policies configured</p></UiCard
		><LoggingSummaryComponent :configs="data.team_info.metadata?.logging" />
	</div>
</template>
