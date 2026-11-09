<script setup lang="ts">
import { computed } from "vue";
import UiTable from "../../platform/ui/UiTable.vue";
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
const columns = computed(() => [
	{ key: "user_email", label: "User Email" },
	{ key: "user_id", label: "User ID" },
	{ key: "role", label: props.organization ? "Organization Role" : "Team Role" },
	...(props.organization
		? [
				{ key: "spend", label: "Spend" },
				{ key: "created_at", label: "Created At" },
			]
		: [
				{ key: "spend", label: "Team Member Spend" },
				{ key: "budget", label: "Team Member Budget" },
				{ key: "rate_limits", label: "Team Member Rate Limits" },
			]),
	{ key: "actions", label: "Actions", width: 120 },
]);
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
		<span>{{ members.length }} Member{{ members.length !== 1 ? "s" : "" }}</span
		><UiTable
			:columns="columns"
			:rows="members"
			:row-key="(row) => String(row.user_id ?? row.user_email ?? JSON.stringify(row))"
			compact
			min-width="max-content"
			empty-text="No members found"
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
