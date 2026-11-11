<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatInferenceStore } from "../../stores/ChatInferenceStore";
import ModelName from "../../../providers/ui/ModelNameComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
const props = defineProps<{ store: ChatInferenceStore }>(),
	query = ref(""),
	filtered = computed(() =>
		props.store.state.models
			.filter((model) => !query.value || model.toLowerCase().includes(query.value.toLowerCase()))
			.sort((a, b) => Number(props.store.state.selected.includes(b)) - Number(props.store.state.selected.includes(a))),
	);
</script>
<template>
	<span v-if="store.state.loadingModels" class="chat-skeleton chat-model-skeleton"></span
	><UiPopover v-else trigger="click" placement="bottomLeft" popup-class="chat-model-popover"
		><button type="button" class="chat-model-trigger">
			<span v-if="!store.state.selected.length" class="chat-muted">Select model</span
			><template v-else-if="store.state.selected.length === 1"
				><ModelName :model="store.state.selected[0]" v-bind="store.state.modelIcons.get(store.state.selected[0])" /></template
			><span v-else class="chat-model-trigger__multiple"
				><span v-for="model in store.state.selected" :key="model"
					><ModelName :model="model" v-bind="store.state.modelIcons.get(model)" /></span></span
			><UiIcon name="DownOutlined" /></button
		><template #content
			><div class="chat-model-options">
				<div><input v-model="query" autofocus placeholder="Search models..." /></div>
				<p v-if="store.state.selected.length >= 3">Max 3 models selected — deselect one to change.</p>
				<div class="chat-model-options__list">
					<button
						v-for="model in filtered"
						:key="model"
						type="button"
						:disabled="!store.state.selected.includes(model) && store.state.selected.length >= 3"
						:class="{ 'is-selected': store.state.selected.includes(model) }"
						@click="store.toggleModel(model)"
					>
						<i><UiIcon v-if="store.state.selected.includes(model)" name="CheckOutlined" /></i
						><ModelName :model="model" v-bind="store.state.modelIcons.get(model)" />
					</button>
				</div></div></template
	></UiPopover>
</template>
