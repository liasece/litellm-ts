<script setup lang="ts">
import { computed } from "vue";
import type { PolicyAttachment } from "../../support/PolicyModels";
import { policyDate } from "../../logic/PolicyLogic";
import { createPolicyTableSort } from "../../logic/PolicyTableLogic";
import PolicyImpactPopoverComponent from "./PolicyImpactPopoverComponent.vue";
import PolicySortHeaderComponent from "../common/PolicySortHeaderComponent.vue";
import PolicyTagsComponent from "../common/PolicyTagsComponent.vue";
import PolicyBadgeComponent from "../common/PolicyBadgeComponent.vue";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
const props = defineProps<{ attachments: PolicyAttachment[]; loading: boolean; isAdmin: boolean }>(),
	emit = defineEmits<{ delete: [id: string] }>();
const scopes = [
		{ key: "teams", label: "Teams", color: "cyan" },
		{ key: "keys", label: "Keys", color: "purple" },
		{ key: "models", label: "Models", color: "green" },
		{ key: "tags", label: "Tags", color: "orange" },
	] as const,
	columns = [
		{ key: "attachment_id", label: "Attachment ID" },
		{ key: "policy_name", label: "Policy" },
		{ key: "scope", label: "Scope" },
		...scopes,
		{ key: "created_at", label: "Created At" },
	],
	sort = createPolicyTableSort<PolicyAttachment>({ key: "created_at", desc: true }, (row, key) => {
		const value = row[key as keyof PolicyAttachment];
		return Array.isArray(value) ? value.join(",") : typeof value === "string" ? value : "";
	}),
	rows = computed(() => sort.rows(props.attachments));
</script>
<template>
	<div class="policy-data-table">
		<div>
			<table>
				<thead>
					<tr>
						<th v-for="column in columns" :key="column.key" scope="col">
							<PolicySortHeaderComponent
								:label="column.label"
								:order="sort.order(column.key)"
								@sort="sort.toggle(column.key, $event)"
							/>
						</th>
						<th class="policy-actions-cell">Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="loading">
						<td :colspan="9" class="policy-table-empty">Loading...</td>
					</tr>
					<tr v-else-if="!rows.length">
						<td :colspan="9" class="policy-table-empty">No attachments found</td>
					</tr>
					<tr v-for="row in loading ? [] : rows" :key="row.attachment_id">
						<td>
							<UiTooltip :title="row.attachment_id"
								><span class="policy-mono">{{ row.attachment_id.slice(0, 7) }}...</span></UiTooltip
							>
						</td>
						<td>
							<PolicyBadgeComponent small>{{ row.policy_name }}</PolicyBadgeComponent>
						</td>
						<td>
							<PolicyBadgeComponent v-if="row.scope === '*'" color="amber" small>Global (*)</PolicyBadgeComponent
							><span v-else :class="{ 'policy-muted': !row.scope }">{{ row.scope || "-" }}</span>
						</td>
						<td v-for="scope in scopes" :key="scope.key">
							<PolicyTagsComponent :values="row[scope.key]" :color="scope.color" :limit="2" />
						</td>
						<td>
							<UiTooltip :title="row.created_at || ''">{{ policyDate(row.created_at) }}</UiTooltip>
						</td>
						<td class="policy-actions-cell">
							<div class="policy-icon-actions">
								<PolicyImpactPopoverComponent :attachment="row" /><UiTooltip v-if="isAdmin" title="Delete attachment"
									><button type="button" aria-label="Delete attachment" @click="emit('delete', row.attachment_id)">
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
