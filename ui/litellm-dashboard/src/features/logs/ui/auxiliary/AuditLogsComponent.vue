<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { getServerRootPath } from "../../../platform/api/HttpApiClient";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTable from "../../../platform/ui/UiTable.vue";
import UiPagination from "../../../platform/ui/UiPagination.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import { createAuditLogsStore } from "../../stores/AuditLogsStore";
import { AUDIT_ACTION_COLORS, AUDIT_TABLE_NAMES, auditTimestamp } from "../../logic/AuditLogLogic";
import type { AuditLogEntry } from "../../api/AuxiliaryLogsApi";
import { auditEntrySchema } from "../../api/AuxiliaryLogsApi";
import AuditLogDrawerComponent from "./AuditLogDrawerComponent.vue";
const props = withDefaults(defineProps<{ isActive?: boolean }>(), { isActive: true });
const auth = useAuthenticationStore(),
	store = createAuditLogsStore(),
	selected = ref<AuditLogEntry | null>(null),
	open = ref(false),
	previewFailed = ref(false);
const draft = reactive({ object_id: "", changed_by: "", object_team_id: "", object_key_hash: "" });
const premium = computed(() => auth.state.session?.premium_user ?? false);
const columns = [
	{ key: "updated_at", label: "Timestamp", width: 200 },
	{ key: "action", label: "Action", width: 100 },
	{ key: "table_name", label: "Table", width: 130 },
	{ key: "object_id", label: "Object ID" },
	{ key: "changed_by", label: "Changed By", width: 200 },
	{ key: "changed_by_api_key", label: "API Key (Hash)", width: 140 },
];
function updateDraft(name: keyof typeof draft, value: string | number | null) {
	draft[name] = String(value ?? "");
	if (!value) store.filter(name, "");
}
function select(row: Record<string, unknown>) {
	selected.value = auditEntrySchema.parse(row);
	open.value = true;
}
onMounted(() => {
	if (props.isActive) void store.load();
});
watch(
	() => props.isActive,
	(value) => {
		if (value) void store.load();
	},
);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="!premium" class="audit-enterprise">
		<h1>✨ Enterprise Feature.</h1>
		<p>This is a LiteLLM Enterprise feature, and requires a valid key to use.</p>
		<p>Here's a preview of what Audit Logs offer:</p>
		<img
			v-if="!previewFailed"
			:src="getServerRootPath().replace(/\/$/, '') + '/ui/assets/audit-logs-preview.png'"
			alt="Audit Logs Preview"
			@error="previewFailed = true"
		/>
	</div>
	<template v-else>
		<div class="audit-log-card">
			<div class="audit-log-controls">
				<h1>Audit Logs</h1>
				<div class="audit-filters">
					<div
						v-for="field in [
							{ key: 'object_id' as const, label: 'Object ID', width: 200 },
							{ key: 'changed_by' as const, label: 'Changed By', width: 180 },
							{ key: 'object_team_id' as const, label: 'Team ID', width: 180 },
							{ key: 'object_key_hash' as const, label: 'Key Hash', width: 180 },
						]"
						:key="field.key"
						class="audit-search"
						:style="{ width: field.width + 'px' }"
					>
						<UiInput
							:model-value="draft[field.key]"
							:placeholder="field.label"
							clearable
							@update:model-value="updateDraft(field.key, $event)"
							@keydown.enter="store.filter(field.key, draft[field.key])"
						/><UiButton :aria-label="'Search ' + field.label" @click="store.filter(field.key, draft[field.key])"
							><template #icon><UiIcon name="SearchOutlined" /></template
						></UiButton>
					</div>
					<UiSelect
						:model-value="store.state.filters.action || null"
						:options="[
							{ label: 'Created', value: 'created' },
							{ label: 'Updated', value: 'updated' },
							{ label: 'Deleted', value: 'deleted' },
							{ label: 'Rotated', value: 'rotated' },
						]"
						placeholder="All Actions"
						clearable
						style="width: 140px"
						@update:model-value="store.filter('action', String($event ?? ''))"
					/>
					<UiSelect
						:model-value="store.state.filters.table_name || null"
						:options="Object.entries(AUDIT_TABLE_NAMES).map(([value, label]) => ({ value, label }))"
						placeholder="All Tables"
						clearable
						style="width: 150px"
						@update:model-value="store.filter('table_name', String($event ?? ''))"
					/>
					<div class="audit-pagination">
						<UiButton :disabled="store.state.fetching" aria-label="Refresh audit logs" @click="store.load"
							><template #icon
								><UiIcon name="ReloadOutlined" :class="{ 'logs-spinning': store.state.fetching }" /></template></UiButton
						><UiPagination
							:model-value="store.state.page"
							:total="store.state.total"
							:page-size="50"
							show-total
							@update:model-value="store.page"
							><template #total="{ total }">{{ total }} total</template></UiPagination
						>
					</div>
				</div>
			</div>
			<UiTable :columns="columns" :rows="store.rows.value" row-key="id" :loading="store.state.loading" compact @row-click="select">
				<template #cell-updated_at="{ value }"
					><span class="logs-mono" style="font-size: 12px; line-height: 16px; white-space: nowrap">{{
						auditTimestamp(String(value))
					}}</span></template
				>
				<template #cell-action="{ value }"
					><UiTag :color="AUDIT_ACTION_COLORS[String(value)] || 'default'" style="text-transform: capitalize">{{
						value
					}}</UiTag></template
				>
				<template #cell-table_name="{ value }">{{ AUDIT_TABLE_NAMES[String(value)] || value }}</template>
				<template #cell-object_id="{ value }"
					><span class="logs-mono" style="font-size: 12px; line-height: 16px">{{ value }}</span></template
				>
				<template #cell-changed_by="{ value }"
					><UiTag v-if="value === 'default_user_id'" color="blue">Default Proxy Admin</UiTag
					><span v-else>{{ value }}</span></template
				>
				<template #cell-changed_by_api_key="{ value }"
					><span class="logs-mono" style="font-size: 12px; line-height: 16px">{{
						value ? String(value).slice(0, 12) + "…" : "—"
					}}</span></template
				>
			</UiTable>
		</div>
		<AuditLogDrawerComponent :open="open" :log="selected" @close="open = false" />
	</template>
</template>
<style>
.audit-enterprise {
	text-align: center;
	margin-top: 20px;
}
.audit-enterprise h1,
.audit-enterprise p {
	display: block;
	margin: 0 0 10px;
	font-size: 16px;
	font-weight: 400;
	line-height: 24px;
}
.audit-enterprise p:nth-child(3) {
	margin-bottom: 20px;
	font-style: italic;
}
.audit-enterprise img {
	max-width: 100%;
	max-height: 700px;
	border-radius: 8px;
	box-shadow: 0 4px 8px #0000001a;
	margin: 0 auto;
}
.audit-log-card {
	background: white;
	border-radius: 8px;
	box-shadow:
		0 1px 3px #0000001a,
		0 1px 2px -1px #0000001a;
}
.audit-log-controls {
	padding: 16px 24px;
	border-bottom: 1px solid #e5e7eb;
}
.audit-log-controls h1 {
	margin: 0 0 16px;
	font-size: 20px;
	font-weight: 600;
	line-height: 28px;
}
.audit-filters {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
}
.audit-search {
	display: flex;
}
.audit-search .ui-input-wrapper {
	min-width: 0;
	flex: 1;
	border-radius: 6px 0 0 6px;
}
.audit-search > .ui-button {
	border-radius: 0 6px 6px 0;
	margin-left: -1px;
}
.audit-pagination {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 8px;
}
.audit-pagination .ui-pagination {
	gap: 8px;
	margin: 0;
	line-height: 22px;
}
.audit-pagination .ui-pagination__item {
	min-width: 24px;
	height: 24px;
	padding: 0;
	border-color: transparent;
	line-height: 22px;
}
.audit-pagination .ui-pagination__item--active {
	border-color: #1677ff;
}
.audit-log-card .ui-table__row {
	cursor: pointer;
}
</style>
