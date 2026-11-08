<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { copyText } from "../../../content/logic/ClipboardLogic";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
const props = defineProps<{ label: string; value?: Record<string, unknown> | null; simpleKey?: boolean }>();
const money = useMoneyFormatter(),
	copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
const empty = computed(() => !props.value || !Object.keys(props.value).length);
const simple = computed(
	() => props.simpleKey && !empty.value && Object.keys(props.value || {}).every((key) => ["token", "spend", "max_budget"].includes(key)),
);
async function copy() {
	try {
		await copyText(JSON.stringify(props.value, null, 2));
		copied.value = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			copied.value = false;
		}, 2000);
	} catch {
		/* Keep content available for manual selection. */
	}
}
onBeforeUnmount(() => {
	if (timer) clearTimeout(timer);
});
</script>
<template>
	<div class="audit-json-block">
		<div class="audit-json-heading">
			<span>{{ label }}</span
			><button v-if="!empty && !simple" type="button" title="Copy JSON" @click="copy">
				<UiIcon :name="copied ? 'CheckOutlined' : 'CopyOutlined'" :style="copied ? { color: '#16a34a' } : undefined" />
			</button>
		</div>
		<p v-if="empty" class="audit-json-na">N/A</p>
		<div v-else-if="simple" class="audit-simple-key">
			<p v-if="value?.token !== undefined"><span>Token:</span> {{ value.token ?? "N/A" }}</p>
			<p v-if="value?.spend !== undefined"><span>Spend:</span> {{ money(Number(value.spend), 6) }}</p>
			<p v-if="value?.max_budget !== undefined"><span>Max Budget:</span> {{ money(Number(value.max_budget), 6) }}</p>
		</div>
		<pre v-else>{{ JSON.stringify(value, null, 2) }}</pre>
	</div>
</template>
<style>
.audit-json-block {
	border: 1px solid #e5e7eb;
	border-radius: 4px;
	overflow: hidden;
	background: white;
}
.audit-json-heading {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px 12px;
	border-bottom: 1px solid #e5e7eb;
	background: #f9fafb;
	font-size: 12px;
	line-height: 16px;
	font-weight: 600;
	color: #4b5563;
}
.audit-json-heading button {
	background: transparent;
	border: 0;
	padding: 4px;
	border-radius: 4px;
	cursor: pointer;
	color: #6b7280;
}
.audit-json-heading button:hover {
	background: #e5e7eb;
	color: #374151;
}
.audit-json-block pre {
	padding: 12px;
	margin: 0;
	overflow: auto;
	max-height: 384px;
	white-space: pre-wrap;
	word-break: break-all;
	background: white;
	font: 12px/16px var(--ui-font-mono);
}
.audit-json-na {
	padding: 12px;
	margin: 0;
	font-size: 12px;
	line-height: 16px;
	color: #9ca3af;
	font-style: italic;
}
.audit-simple-key {
	padding: 12px;
	font-size: 12px;
	line-height: 16px;
}
.audit-simple-key p {
	margin: 0 0 4px;
}
.audit-simple-key p:last-child {
	margin-bottom: 0;
}
.audit-simple-key span {
	color: #6b7280;
}
</style>
