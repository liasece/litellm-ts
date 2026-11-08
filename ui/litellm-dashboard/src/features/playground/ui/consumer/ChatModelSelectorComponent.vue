<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChatInferenceStore } from "../../stores/ChatInferenceStore";
import { getModelLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
const props = defineProps<{ store: ChatInferenceStore }>(),
	query = ref(""),
	filtered = computed(() =>
		props.store.state.models
			.filter((model) => !query.value || model.toLowerCase().includes(query.value.toLowerCase()))
			.sort((a, b) => Number(props.store.state.selected.includes(b)) - Number(props.store.state.selected.includes(a))),
	);
function logo(model: string) {
	return getModelLogoAndName("", model).logo;
}
function hide(event: Event) {
	(event.target as HTMLImageElement).style.display = "none";
}
</script>
<template>
	<span v-if="store.state.loadingModels" class="chat-skeleton chat-model-skeleton"></span
	><UiPopover v-else trigger="click" placement="bottomLeft" popup-class="chat-model-popover"
		><button type="button" class="chat-model-trigger">
			<span v-if="!store.state.selected.length" class="chat-muted">Select model</span
			><template v-else-if="store.state.selected.length === 1"
				><img v-if="logo(store.state.selected[0])" :src="logo(store.state.selected[0])" alt="" @error="hide" /><span>{{
					store.state.selected[0]
				}}</span></template
			><span v-else class="chat-model-trigger__multiple"
				><span v-for="model in store.state.selected" :key="model"
					><img v-if="logo(model)" :src="logo(model)" alt="" @error="hide" /><span>{{ model }}</span></span
				></span
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
						><img v-if="logo(model)" :src="logo(model)" alt="" @error="hide" /><span
							v-else
							class="chat-model-options__logo-space"
						></span
						><span>{{ model }}</span>
					</button>
				</div>
			</div></template
		></UiPopover
	>
</template>
