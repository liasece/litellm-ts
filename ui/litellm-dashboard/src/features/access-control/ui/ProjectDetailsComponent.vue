<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import { computed, ref, watch } from "vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { accessApi } from "../api/AccessApi";
import type { AccessProject, AccessTeam } from "../support/AccessModels";
const props = defineProps<{ open: boolean; project: AccessProject | null; loading?: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; edit: [] }>();
const money = useMoneyFormatter(),
	team = ref<AccessTeam | null>(null);
let generation = 0;
watch(
	() => props.project?.team_id,
	async (id) => {
		const current = ++generation;
		team.value = null;
		if (id) {
			try {
				const result = await accessApi.team(id);
				if (current === generation) team.value = result.team_info;
			} catch {
				team.value = null;
			}
		}
	},
	{ immediate: true },
);
async function copy(value: string) {
	await navigator.clipboard.writeText(value).catch(() => undefined);
}
const teamBudget = computed(() => team.value?.max_budget ?? null),
	teamLimit = computed(() => teamBudget.value != null && Number(teamBudget.value) > 0),
	teamPercent = computed(() => (teamLimit.value ? Math.min(((team.value?.spend ?? 0) / Number(teamBudget.value)) * 100, 100) : 0)),
	teamColor = computed(() => (teamPercent.value >= 90 ? "#f5222d" : teamPercent.value >= 70 ? "#faad14" : "#52c41a"));
const maxBudget = computed(() => props.project?.litellm_budget_table?.max_budget),
	hasLimit = computed(() => maxBudget.value != null && Number(maxBudget.value) > 0),
	percent = computed(() => (hasLimit.value ? Math.min(((props.project?.spend ?? 0) / Number(maxBudget.value)) * 100, 100) : 0)),
	modelSpend = computed(() => Object.entries(props.project?.model_spend ?? {}).sort((a, b) => b[1] - a[1]));
</script>
<template>
	<UiDrawer :open="open" @update:open="emit('update:open', $event)">
		<template #title>
			<div class="access-drawer-resource-title">
				<div class="access-drawer-resource-identity">
					<div>{{ project?.project_alias ?? project?.project_id ?? "Project details" }}</div>
					<div v-if="project" class="access-drawer-resource-subtitle">{{ project.project_id }}</div>
				</div>
				<div v-if="project" class="access-drawer-resource-actions">
					<UiButton variant="primary" @click="emit('edit')"
						><template #icon><UiIcon name="EditOutlined" /></template>Edit Project</UiButton
					>
				</div>
			</div>
		</template>
		<p v-if="loading && !project">Loading project details...</p>
		<p v-else-if="!project">Project not found</p>
		<div v-else class="access-project-detail">
			<div class="access-project-status">
				<UiTag :color="project.blocked ? 'red' : 'green'">{{ project.blocked ? "Blocked" : "Active" }}</UiTag
				><span class="access-muted access-project-id"
					>ID:&nbsp;<button type="button" class="access-copy-text access-project-id-value" @click="copy(project.project_id)">
						{{ project.project_id }}<UiIcon name="CopyOutlined" :size="14" /></button
				></span>
			</div>
			<UiCard appearance="antd" class="access-metadata-card"
				><h5>Project Details</h5>
				<dl class="access-descriptions">
					<div class="access-description-row">
						<dt>Description</dt>
						<dd>{{ project.description || "—" }}</dd>
					</div>
					<div class="access-description-row">
						<dt>Created</dt>
						<dd>
							{{ new Date(project.created_at).toLocaleString()
							}}<span v-if="project.created_by"
								>&nbsp;by&nbsp;{{
									project.created_by === "default_user_id" ? "Default Proxy Admin" : project.created_by
								}}</span
							>
						</dd>
					</div>
					<div class="access-description-row">
						<dt>Last Updated</dt>
						<dd>
							{{ new Date(project.updated_at).toLocaleString()
							}}<span v-if="project.updated_by"
								>&nbsp;by&nbsp;{{
									project.updated_by === "default_user_id" ? "Default Proxy Admin" : project.updated_by
								}}</span
							>
						</dd>
					</div>
				</dl></UiCard
			>
			<div class="access-columns access-budget-columns">
				<UiCard appearance="antd"
					><template #title><UiLucideIcon name="DollarSignIcon" :size="16" />Budget</template
					><strong class="access-large-money">{{ money(project.spend, 2) }}</strong>
					<p class="access-budget-caption">
						{{ hasLimit ? "of " + money(maxBudget, 2) + " budget" : "No budget limit" }}
					</p>
					<div v-if="hasLimit" class="access-budget-progress">
						<div class="access-progress">
							<span
								:style="{
									width: percent + '%',
									background: percent >= 90 ? '#f5222d' : percent >= 70 ? '#faad14' : '#52c41a',
								}"
							/>
						</div>
						<small class="access-muted">{{ percent.toFixed(1) }}% utilized</small>
					</div></UiCard
				><UiCard appearance="antd" title="Spend by Model"
					><UiEmptyState v-if="!modelSpend.length" description="No model spend recorded yet" />
					<div v-else class="access-model-spend">
						<div v-for="[model, spend] in modelSpend" :key="model" class="access-model-spend-row">
							<span>{{ model }}</span>
							<div>
								<span :style="{ width: (spend / Math.max(...modelSpend.map((entry) => entry[1]), 1)) * 100 + '%' }" />
							</div>
							<span>{{ money(spend, 4) }}</span>
						</div>
					</div></UiCard
				>
			</div>
			<div class="access-columns access-project-resources">
				<UiCard appearance="antd"
					><template #title><UiLucideIcon name="KeyIcon" :size="16" />Keys</template
					><UiEmptyState description="No keys to display" /></UiCard
				><UiCard appearance="antd" class="access-project-team-card"
					><template #title><UiLucideIcon name="UsersIcon" :size="16" />Team</template>
					<div v-if="team" class="access-project-team">
						<div>
							<strong>{{ team.team_alias || team.team_id }}</strong>
							<p class="access-muted access-team-id">
								ID:&nbsp;<button type="button" class="access-copy-text access-team-id-value" @click="copy(team.team_id)">
									{{ team.team_id }}<UiIcon name="CopyOutlined" :size="14" />
								</button>
							</p>
						</div>
						<div>
							<p class="access-muted access-team-label">Models</p>
							<div class="access-tags">
								<UiTag v-for="model in team.models" :key="model">{{ model }}</UiTag
								><span v-if="!team.models.length" class="access-muted">All models</span>
							</div>
						</div>
						<div>
							<div class="access-team-spend-row">
								<span class="access-muted">Spend</span>
								<span
									>{{ money(team.spend, 2)
									}}<span class="access-muted">{{
										teamLimit ? " / " + money(teamBudget, 2) : " (Unlimited)"
									}}</span></span
								>
							</div>
							<div v-if="teamLimit" class="access-progress access-team-progress">
								<span :style="{ width: teamPercent + '%', background: teamColor }" />
							</div>
						</div>
						<div class="access-team-members-row">
							<span class="access-muted">Members</span><span>{{ team.members_with_roles.length }}</span>
						</div>
					</div>
					<UiEmptyState v-else-if="!project.team_id" description="No team assigned" />
					<p v-else class="access-muted">Loading...</p></UiCard
				>
			</div>
		</div>
	</UiDrawer>
</template>
