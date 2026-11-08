<script setup lang="ts">
import { ref, watch, onBeforeUnmount, onMounted } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import { promptsApi } from "../api/PromptsApi";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import type { PromptSpec } from "../support/PromptModels";
const open = defineModel<boolean>("open", { required: true }),
	props = defineProps<{ promptId: string; activeVersionId?: string }>(),
	emit = defineEmits<{ select: [version: PromptSpec] }>(),
	auth = useAuthenticationStore(),
	versions = ref<PromptSpec[]>([]),
	loading = ref(false);
let generation = 0;
function number(item: PromptSpec) {
	if (item.version) return "v" + item.version;
	const id = item.litellm_params?.prompt_id || item.prompt_id;
	if (id.includes(".v")) return "v" + id.split(".v")[1];
	if (id.includes("_v")) return "v" + id.split("_v")[1];
	return "v1";
}
function selected(item: PromptSpec, index: number) {
	const id = props.activeVersionId;
	let active: number | null = null;
	if (id?.includes(".v")) active = parseInt(id.split(".v")[1]);
	else if (id?.includes("_v")) active = parseInt(id.split("_v")[1]);
	return active ? (item.version || parseInt(number(item).replace("v", ""))) === active : index === 0;
}
watch(
	() => [open.value, props.promptId, auth.isAuthorized.value],
	async () => {
		if (!open.value || !auth.isAuthorized.value || !props.promptId) return;
		const current = ++generation;
		loading.value = true;
		try {
			const result = await promptsApi.versions(props.promptId.includes(".v") ? props.promptId.split(".v")[0] : props.promptId);
			if (current === generation) versions.value = result;
		} catch {
			/* Existing history keeps previously loaded versions when its optional refresh fails. */
		} finally {
			if (current === generation) loading.value = false;
		}
	},
	{ immediate: true },
);
function key(event: KeyboardEvent) {
	if (open.value && event.key === "Escape") {
		event.preventDefault();
		event.stopImmediatePropagation();
		open.value = false;
	}
}
onMounted(() => window.addEventListener("keydown", key, true));
onBeforeUnmount(() => {
	++generation;
	window.removeEventListener("keydown", key, true);
});
</script>
<template>
	<aside v-if="open" class="prompt-history-panel" role="dialog" aria-label="Version History">
		<header>
			<button type="button" aria-label="Close" @click="open = false"><UiIcon name="CloseOutlined" :size="14" /></button>
			<h2>Version History</h2>
		</header>
		<div>
			<div v-if="loading" class="prompt-history-skeleton" aria-label="Loading">
				<span />
				<p v-for="index in 4" :key="index" />
			</div>
			<p v-else-if="!versions.length" class="prompt-history-empty">No version history available.</p>
			<button
				v-for="(item, index) in versions"
				v-else
				:key="item.prompt_id + '-' + (item.version || number(item))"
				type="button"
				:class="['prompt-history-version', { selected: selected(item, index) }]"
				@click="emit('select', item)"
			>
				<header>
					<div>
						<UiTag>{{ number(item) }}</UiTag
						><UiTag v-if="index === 0" color="blue">Latest</UiTag>
					</div>
					<UiTag v-if="selected(item, index)" color="green">Active</UiTag>
				</header>
				<strong>{{ item.created_at ? new Date(item.created_at).toLocaleString() : "-" }}</strong
				><small>{{ item.prompt_info?.prompt_type === "db" ? "Saved to Database" : "Config Prompt" }}</small>
			</button>
		</div>
	</aside>
</template>
