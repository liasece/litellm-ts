<script setup lang="ts">
import { computed, ref } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
import { filterRowsByFields } from "../../platform/ui/UiTableFilterLogic";
import type { UiTableActiveFilter, UiTableFilterField } from "../../platform/ui/UiTableFilterModels";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { objectValue } from "../logic/ResourceDraftLogic";
import type { AccessMember, AccessRecord } from "../support/AccessModels";
const props = withDefaults(
	defineProps<{
		members: AccessMember[];
		memberships?: AccessRecord[];
		organization?: boolean;
		canEdit: boolean;
		canDelete?: boolean;
	}>(),
	{ canDelete: true, memberships: () => [], organization: false },
);
const emit = defineEmits<{ add: []; delete: [member: AccessMember] }>();
const money = useMoneyFormatter();
const emailFilter: readonly UiTableFilterField[] = [
	{ key: "user_email", label: "User Email", control: { kind: "text", placeholder: "Filter user email" } },
];
const idFilter: readonly UiTableFilterField[] = [
	{ key: "user_id", label: "User ID", control: { kind: "text", placeholder: "Filter user ID" } },
];
const activeFilters = ref<UiTableActiveFilter[]>([]);
function roleValue(row: AccessRecord): string {
	return String((props.organization ? row.user_role || row.role : row.role) ?? "");
}
const roleOptions = computed(() => {
	const defaults = props.organization ? ["org_admin", "internal_user", "internal_user_viewer"] : ["admin", "user"];
	const values = [...new Set([...defaults, ...props.members.map(roleValue)])].filter(Boolean);
	return values.map((value) => ({
		value,
		label: value
			.split("_")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" "),
	}));
});
const roleFilter = computed<readonly UiTableFilterField[]>(() => [
	{ key: "role", label: props.organization ? "Organization Role" : "Team Role", control: { kind: "select", options: roleOptions.value } },
]);
const columns = computed(() => [
	{ key: "user_email", label: "User Email", sortable: true, filters: emailFilter },
	{ key: "user_id", label: "User ID", sortable: true, filters: idFilter },
	{ key: "role", label: props.organization ? "Organization Role" : "Team Role", sortable: true, filters: roleFilter.value },
	...(props.organization
		? [
				{ key: "spend", label: "Spend", sortable: true },
				{ key: "created_at", label: "Created At", sortable: true },
			]
		: [
				{ key: "spend", label: "Team Member Spend", sortable: true },
				{ key: "budget", label: "Team Member Budget" },
				{ key: "rate_limits", label: "Team Member Rate Limits" },
			]),
	{ key: "actions", label: "Actions", width: 120 },
]);
const filteredMembers = computed(() =>
	filterRowsByFields(props.members, activeFilters.value, (row, key) => (key === "role" ? roleValue(row) : row[key])),
);
const emptyText = computed(() => (activeFilters.value.length ? "No members match the current filters" : "No members found"));
function applyMemberFilters(entries: readonly UiTableActiveFilter[]): void {
	const next = activeFilters.value.filter((filter) => !entries.some((entry) => entry.key === filter.key));
	for (const entry of entries) {
		if (entry.value.trim()) next.push({ ...entry, value: entry.value.trim(), text: entry.text || entry.value.trim() });
	}
	activeFilters.value = next;
}
function removeMemberFilter(key: string): void {
	activeFilters.value = activeFilters.value.filter((filter) => filter.key !== key);
}
function clearMemberFilters(): void {
	activeFilters.value = [];
}
function member(row: AccessRecord): AccessMember {
	return row as AccessMember;
}
function membership(row: AccessRecord) {
	return props.memberships?.find((item) => item.user_id === row.user_id) ?? {};
}
function budget(row: AccessRecord) {
	return objectValue(membership(row).litellm_budget_table);
}
function rateLimits(row: AccessRecord) {
	const value = budget(row);
	return (
		[value.rpm_limit ? value.rpm_limit + " RPM" : null, value.tpm_limit ? value.tpm_limit + " TPM" : null]
			.filter(Boolean)
			.join(" / ") || "No Limits"
	);
}
</script>
<template>
	<section class="access-members" :class="organization ? 'access-members--organization' : 'access-members--team'">
		<span
			>{{ filteredMembers.length }} Member{{ filteredMembers.length !== 1 ? "s" : ""
			}}<template v-if="activeFilters.length"> of {{ members.length }}</template></span
		><UiTable
			:columns="columns"
			:rows="filteredMembers"
			:row-key="(row) => String(row.user_id ?? row.user_email ?? JSON.stringify(row))"
			compact
			min-width="max-content"
			:empty-text="emptyText"
			:active-filters="activeFilters"
			@filter-change="applyMemberFilters"
			@remove-filter="removeMemberFilter"
			@clear-filters="clearMemberFilters"
			><template #header-role
				><span :class="{ 'access-member-header': !organization }"
					>{{ organization ? "Organization Role" : "Team Role"
					}}<UiIcon v-if="!organization" name="InfoCircleOutlined" :size="14" /></span></template
			><template #header-spend
				><span :class="{ 'access-member-header': !organization }"
					>{{ organization ? "Spend" : "Team Member Spend"
					}}<UiIcon v-if="!organization" name="InfoCircleOutlined" :size="14" /></span></template
			><template v-if="!organization" #header-rate_limits
				><span class="access-member-header">Team Member Rate Limits<UiIcon name="InfoCircleOutlined" :size="14" /></span></template
			><template #cell-user_email="{ value }">{{ value || "-" }}</template
			><template #cell-user_id="{ value }"
				><UiTag v-if="value === 'default_user_id'" color="blue">Default Proxy Admin</UiTag
				><span v-else>{{ value || "-" }}</span></template
			><template #cell-role="{ row, value }"
				><div class="access-member-role">
					<UiIcon
						:name="
							String(organization ? row.user_role || value : value)
								.toLowerCase()
								.includes('admin')
								? 'CrownOutlined'
								: 'UserOutlined'
						"
						:size="14"
					/><span class="access-capitalize">{{ (organization ? row.user_role || value : value) || "-" }}</span>
				</div></template
			><template #cell-spend="{ row }">{{
				money(organization ? Number(row.spend ?? 0) : Number(membership(row).spend ?? 0), 4)
			}}</template
			><template #cell-created_at="{ value }">{{ value ? new Date(String(value)).toLocaleString() : "-" }}</template
			><template #cell-budget="{ row }">{{
				budget(row).max_budget == null ? "No Limit" : money(Number(budget(row).max_budget), 4)
			}}</template
			><template #cell-rate_limits="{ row }">{{ rateLimits(row) }}</template
			><template #cell-actions="{ row }"
				><div v-if="canEdit" class="access-member-actions">
					<AccessActionComponent
						v-if="canDelete !== false"
						appearance="tremor"
						name="Trash2"
						label="Delete member"
						data-testid="delete-member"
						@click="emit('delete', member(row))"
					/></div></template></UiTable
		><UiButton v-if="canEdit" variant="primary" @click="emit('add')"
			><template #icon><UiIcon name="UserAddOutlined" /></template>Add Member</UiButton
		>
	</section>
</template>
