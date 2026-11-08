<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiTable from "../../../platform/ui/UiTable.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { guardrailsApi } from "../../api/GuardrailsApi";
import type { GuardrailContentCategory, SelectedGuardrailCategory } from "../../support/GuardrailModels";
const categories = defineModel<SelectedGuardrailCategory[]>({ required: true }),
	pending = defineModel<string>("pending", { default: "" }),
	props = defineProps<{ available: GuardrailContentCategory[] }>(),
	auth = useAuthenticationStore(),
	cache = reactive<Record<string, string>>({}),
	fileTypes = reactive<Record<string, string>>({}),
	loading = reactive<Record<string, boolean>>({}),
	preview = ref(""),
	previewLoading = ref(false),
	availableOptions = computed(() =>
		props.available
			.filter((category) => !categories.value.some((selected) => selected.category === category.name))
			.map((category) => ({ value: category.name, label: category.display_name, description: category.description })),
	),
	rows = computed(() => categories.value.map((row) => ({ ...row }))),
	columns = [
		{ key: "display_name", label: "Category" },
		{ key: "action", label: "Action", width: 150 },
		{ key: "severity_threshold", label: "Severity Threshold", width: 180 },
		{ key: "actions", label: "", width: 80 },
	];
function format(content: string, type?: string) {
	if (type === "json")
		try {
			return JSON.stringify(JSON.parse(content) as unknown, null, 2);
		} catch {
			/* Keep the original file when it is not valid JSON. */
		}
	return content;
}
async function fetch(name: string) {
	if (!auth.isAuthorized.value || cache[name]) return;
	loading[name] = true;
	try {
		const data = await guardrailsApi.category(name);
		cache[name] = format(data.yaml_content, data.file_type);
		fileTypes[name] = data.file_type || "yaml";
	} catch {
		/* The original category preview reports unavailable content inline. */
	} finally {
		loading[name] = false;
	}
}
watch(
	pending,
	async (name, _old, cleanup) => {
		let cancelled = false;
		cleanup(() => (cancelled = true));
		if (!name || !auth.isAuthorized.value) {
			preview.value = "";
			previewLoading.value = false;
			return;
		}
		if (cache[name]) {
			preview.value = cache[name];
			return;
		}
		previewLoading.value = true;
		await fetch(name);
		if (!cancelled) {
			preview.value = cache[name] || "";
			previewLoading.value = false;
		}
	},
	{ immediate: true },
);
function select(value: unknown) {
	if (typeof value === "string") pending.value = value;
}
function add() {
	const category = props.available.find((category) => category.name === pending.value);
	if (!category || categories.value.some((row) => row.category === category.name)) return;
	categories.value = [
		...categories.value,
		{
			id: "category-" + Date.now(),
			category: category.name,
			display_name: category.display_name,
			action: category.default_action === "MASK" ? "MASK" : "BLOCK",
			severity_threshold: "medium",
		},
	];
	pending.value = "";
	preview.value = "";
}
function update(id: string, field: "action" | "severity_threshold", value: unknown) {
	if (typeof value !== "string") return;
	categories.value = categories.value.map((row) => (row.id === id ? { ...row, [field]: value } : row));
}
function source(name: string) {
	return props.available.find((row) => row.name === name);
}
const yamlRoot = ref<HTMLElement>();
function toggle(event: Event) {
	const target = event.target;
	if (target instanceof HTMLDetailsElement && target.open && target.dataset.category) void fetch(target.dataset.category);
}
onMounted(() => yamlRoot.value?.addEventListener("toggle", toggle, true));
onBeforeUnmount(() => yamlRoot.value?.removeEventListener("toggle", toggle, true));
</script>
<template>
	<UiCard appearance="antd" size="small" class="guardrail-topics-card"
		><template #title
			><div><strong>Blocked topics</strong><small>Select topics to block using keyword and semantic analysis</small></div></template
		>
		<div class="guardrail-topic-select">
			<UiSelect
				:model-value="pending || null"
				:options="availableOptions"
				searchable
				placeholder="Select a content category"
				@update:model-value="select"
			/><UiButton variant="primary" :disabled="!pending" @click="add"><UiIcon name="PlusOutlined" />Add</UiButton>
		</div>
		<div v-if="pending" class="guardrail-topic-preview">
			<h4>
				Preview: {{ source(pending)?.display_name
				}}<small v-if="fileTypes[pending]">({{ fileTypes[pending]?.toUpperCase() }})</small>
			</h4>
			<div v-if="previewLoading">Loading content...</div>
			<pre v-else-if="preview"><code>{{ preview }}</code></pre>
			<p v-else>Unable to load category content</p>
		</div>
		<template v-if="categories.length"
			><UiTable :columns="columns" :rows="rows" row-key="id" compact
				><template #cell-display_name="{ row }"
					><strong>{{ row.display_name }}</strong
					><small v-if="source(String(row.category))?.description" class="guardrail-topic-description">{{
						source(String(row.category))?.description
					}}</small></template
				><template #cell-action="{ row }"
					><UiSelect
						:model-value="String(row.action)"
						:options="[
							{ value: 'BLOCK', label: 'BLOCK' },
							{ value: 'MASK', label: 'MASK' },
						]"
						@update:model-value="update(String(row.id), 'action', $event)"
						><template #value="{ option }"
							><UiTag :color="option.value === 'BLOCK' ? 'red' : 'orange'">{{ option.label }}</UiTag></template
						><template #option="{ option }"
							><UiTag :color="option.value === 'BLOCK' ? 'red' : 'orange'">{{ option.label }}</UiTag></template
						></UiSelect
					></template
				><template #cell-severity_threshold="{ row }"
					><UiSelect
						:model-value="String(row.severity_threshold)"
						:options="[
							{ value: 'low', label: 'Low' },
							{ value: 'medium', label: 'Medium' },
							{ value: 'high', label: 'High' },
						]"
						@update:model-value="update(String(row.id), 'severity_threshold', $event)" /></template
				><template #cell-actions="{ row }"
					><UiButton size="small" @click="categories = categories.filter((category) => category.id !== row.id)"
						><UiIcon name="DeleteOutlined" />Remove</UiButton
					></template
				></UiTable
			>
			<div ref="yamlRoot" class="guardrail-topic-yaml">
				<details v-for="category in categories" :key="category.id" :data-category="category.category">
					<summary>
						<UiIcon name="RightOutlined" /><UiIcon name="FileTextOutlined" /><span
							>View {{ (fileTypes[category.category] || "yaml").toUpperCase() }} for {{ category.display_name }}</span
						>
					</summary>
					<div v-if="loading[category.category]">Loading content...</div>
					<pre v-else-if="cache[category.category]"><code>{{ cache[category.category] }}</code></pre>
					<div v-else>Content will load when expanded</div>
				</details>
			</div></template
		>
		<div v-else class="guardrail-topic-empty">No blocked topics selected. Add topics to detect and block harmful content.</div></UiCard
	>
</template>
