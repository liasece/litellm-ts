<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import UiDrawer from "../../../platform/ui/UiDrawer.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { copyText } from "../../../content/logic/ClipboardLogic";
import { AUDIT_ACTION_COLORS, AUDIT_TABLE_NAMES, auditDiff, auditTimestamp } from "../../logic/AuditLogLogic";
import type { AuditLogEntry } from "../../api/AuxiliaryLogsApi";
import AuditJsonBlockComponent from "./AuditJsonBlockComponent.vue";
const props = defineProps<{ open: boolean; log: AuditLogEntry | null }>();
defineEmits<{ close: [] }>();
const diff = computed(() => (props.log ? auditDiff(props.log) : { before: null, after: null })),
	copied = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy(name: string, value: string) {
	try {
		await copyText(value);
		copied.value = name;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			copied.value = null;
		}, 2000);
	} catch {
		/* Keep text selectable. */
	}
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<UiDrawer :open="open && !!log" :closable="false" class="audit-log-drawer" aria-label="Audit log details" @close="$emit('close')">
		<template v-if="log">
			<div class="audit-drawer-header">
				<div>
					<UiTag :color="AUDIT_ACTION_COLORS[log.action] || 'default'" style="text-transform: capitalize; margin: 0">{{
						log.action
					}}</UiTag
					><span>{{ auditTimestamp(log.updated_at) }}</span>
				</div>
				<button type="button" aria-label="Close" @click="$emit('close')"><UiIcon name="CloseOutlined" /></button>
			</div>
			<div class="audit-drawer-body">
				<div class="audit-metadata">
					<p>Details</p>
					<div>
						<span>Table</span><span>{{ AUDIT_TABLE_NAMES[log.table_name] || log.table_name }}</span>
					</div>
					<div>
						<span>Object ID</span
						><span
							><span class="logs-mono audit-copy-text"
								>{{ log.object_id
								}}<button type="button" aria-label="Copy Object ID" @click="copy('object', log.object_id)">
									<UiIcon :name="copied === 'object' ? 'CheckOutlined' : 'CopyOutlined'" :size="12" /></button></span
						></span>
					</div>
					<div>
						<span>Changed By</span
						><span
							><UiTag v-if="log.changed_by === 'default_user_id'" color="blue">Default Proxy Admin</UiTag
							><template v-else>{{ log.changed_by }}</template></span
						>
					</div>
					<div>
						<span>API Key (Hash)</span
						><span
							><span class="logs-mono audit-copy-text audit-copy-text--all"
								>{{ log.changed_by_api_key || "—"
								}}<button
									v-if="log.changed_by_api_key"
									type="button"
									aria-label="Copy API Key Hash"
									@click="copy('key', log.changed_by_api_key)"
								>
									<UiIcon :name="copied === 'key' ? 'CheckOutlined' : 'CopyOutlined'" :size="12" /></button></span
						></span>
					</div>
				</div>
				<div class="audit-diff-grid">
					<AuditJsonBlockComponent
						label="Before"
						:value="diff.before"
						:simple-key="log.table_name === 'LiteLLM_VerificationToken' && ['updated', 'rotated'].includes(log.action)"
					/><AuditJsonBlockComponent
						label="After"
						:value="diff.after"
						:simple-key="log.table_name === 'LiteLLM_VerificationToken' && ['updated', 'rotated'].includes(log.action)"
					/>
				</div>
			</div>
		</template>
	</UiDrawer>
</template>
<style>
.audit-log-drawer .ui-drawer__header {
	display: none;
}
.audit-log-drawer .ui-drawer__body {
	padding: 0;
	display: flex;
	flex-direction: column;
}
.audit-drawer-header {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: space-between;
	padding: 16px 24px;
	border-bottom: 1px solid #e5e7eb;
	background: #fff;
}
.audit-drawer-header > div {
	display: flex;
	align-items: center;
	gap: 12px;
}
.audit-drawer-header > div > span:last-child {
	font-size: 14px;
	line-height: 20px;
	color: #6b7280;
}
.audit-drawer-header button {
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: 0;
	border-radius: 4px;
	color: #6b7280;
	cursor: pointer;
}
.audit-drawer-header button:hover {
	background: #f3f4f6;
}
.audit-drawer-body {
	padding: 20px 24px;
}
.audit-metadata {
	padding: 16px;
	margin-bottom: 20px;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	background: #f9fafb;
}
.audit-metadata > p {
	font-size: 12px;
	line-height: 16px;
	color: #374151;
	text-transform: uppercase;
	letter-spacing: 0.025em;
	font-weight: 600;
	margin: 0 0 8px;
}
.audit-metadata > div {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 6px 0;
	font-size: 12px;
	line-height: 16px;
}
.audit-metadata > div > span:first-child {
	color: #6b7280;
	width: 144px;
	flex-shrink: 0;
}
.audit-metadata > div > span:last-child {
	color: #111827;
	word-break: break-all;
}
.audit-copy-text {
	word-break: break-word;
	font-variant-numeric: normal;
}
.audit-copy-text--all {
	word-break: break-all;
}
.audit-metadata button {
	display: inline-block;
	margin-inline-start: 4px;
	border: 0;
	background: transparent;
	padding: 0;
	color: #1677ff;
	cursor: pointer;
}
.audit-diff-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 16px;
	margin-top: 16px;
}
@media (min-width: 768px) {
	.audit-diff-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
