<script setup lang="ts">
import { computed } from "vue";
import type { Policy } from "../../support/PolicyModels";
import { groupPolicies, policyDate } from "../../logic/PolicyLogic";
import { createPolicyTableSort } from "../../logic/PolicyTableLogic";
import PolicySortHeaderComponent from "../common/PolicySortHeaderComponent.vue";
import PolicyTagsComponent from "../common/PolicyTagsComponent.vue";
import PolicyBadgeComponent from "../common/PolicyBadgeComponent.vue";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
const props = defineProps<{ policies: Policy[]; loading: boolean; isAdmin: boolean }>(),
	emit = defineEmits<{ view: [id: string]; edit: [policy: Policy]; delete: [policy: Policy] }>();
const columns = [
	["policy_name", "Name"],
	["description", "Description"],
	["inherit", "Inherits From"],
	["guardrails_add", "Guardrails (Add)"],
	["guardrails_remove", "Guardrails (Remove)"],
	["condition", "Model Condition"],
	["created_at", "Created At"],
] as const;
const sort = createPolicyTableSort<ReturnType<typeof groupPolicies>[number]>({ key: "policy_name", desc: false }, (row, key) => {
		const policy = row.policy;
		if (key === "condition") return JSON.stringify(policy.condition?.model ?? "");
		const value = policy[key as keyof Policy];
		return Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "";
	}),
	rows = computed(() => sort.rows(groupPolicies(props.policies)));
const condition = (policy: Policy) =>
	typeof policy.condition?.model === "string" ? policy.condition.model : JSON.stringify(policy.condition?.model ?? "");
</script>
<template>
	<div class="policy-data-table">
		<div>
			<table>
				<thead>
					<tr>
						<th
							v-for="[key, label] in columns"
							:key="key"
							scope="col"
							:aria-sort="sort.order(key) === 'asc' ? 'ascending' : sort.order(key) === 'desc' ? 'descending' : 'none'"
						>
							<PolicySortHeaderComponent :label="label" :order="sort.order(key)" @sort="sort.toggle(key, $event)" />
						</th>
						<th class="policy-actions-cell">Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="loading">
						<td :colspan="8" class="policy-table-empty">Loading...</td>
					</tr>
					<tr v-else-if="!rows.length">
						<td :colspan="8" class="policy-table-empty">No policies found</td>
					</tr>
					<tr v-for="row in loading ? [] : rows" :key="row.name">
						<td>
							<div class="policy-name-cell">
								<UiTooltip
									:title="row.policy.policy_name + (row.versionCount > 1 ? ' (' + row.versionCount + ' versions)' : '')"
									><UiButton
										appearance="tremor"
										variant="text"
										size="small"
										class="policy-name-button"
										@click="emit('view', row.policy.policy_id)"
										>{{ row.policy.policy_name || "-" }}</UiButton
									></UiTooltip
								><PolicyBadgeComponent v-if="row.versionCount > 1" color="gray" small
									>{{ row.versionCount }} versions</PolicyBadgeComponent
								>
							</div>
						</td>
						<td>
							<UiTooltip :title="row.policy.description || ''"
								><span class="policy-truncate">{{ row.policy.description || "-" }}</span></UiTooltip
							>
						</td>
						<td>
							<PolicyBadgeComponent v-if="row.policy.inherit" small>{{ row.policy.inherit }}</PolicyBadgeComponent
							><span v-else class="policy-muted">-</span>
						</td>
						<td><PolicyTagsComponent :values="row.policy.guardrails_add" color="green" :limit="2" /></td>
						<td><PolicyTagsComponent :values="row.policy.guardrails_remove" color="red" :limit="2" /></td>
						<td>
							<UiTooltip v-if="row.policy.condition?.model" :title="condition(row.policy)"
								><code>{{
									typeof row.policy.condition.model === "string"
										? condition(row.policy).length > 20
											? condition(row.policy).slice(0, 20) + "..."
											: condition(row.policy)
										: "Multiple"
								}}</code></UiTooltip
							><span v-else class="policy-muted">-</span>
						</td>
						<td>
							<UiTooltip :title="row.policy.created_at || ''">{{ policyDate(row.policy.created_at) }}</UiTooltip>
						</td>
						<td class="policy-actions-cell">
							<div v-if="isAdmin" class="policy-icon-actions">
								<UiTooltip title="Edit policy"
									><button type="button" aria-label="Edit policy" @click="emit('edit', row.policy)">
										<PolicyHeroIconComponent name="Pencil" :size="20" /></button></UiTooltip
								><UiTooltip title="Delete policy"
									><button type="button" aria-label="Delete policy" @click="emit('delete', row.policy)">
										<PolicyHeroIconComponent name="Trash" :size="20" /></button
								></UiTooltip>
							</div>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
