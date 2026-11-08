<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import FallbackGroupEditor from "./FallbackGroupEditorComponent.vue";
import { routerSettingsApi } from "../api/RouterSettingsApi";
import { routerString, type FallbackGroup, type FallbackEntry } from "../support/RouterSettingsModels";
import message from "../../notifications/logic/MessageManager";
const open = defineModel<boolean>("open", { default: false });
defineProps<{ pending?: boolean }>();
const emit = defineEmits<{ save: [groups: FallbackEntry[]] }>();
const groups = ref<FallbackGroup[]>([]),
	models = ref<string[]>([]);
watch(open, async (value) => {
	if (!value) return;
	groups.value = [{ id: "1", primary: "", models: [] }];
	try {
		models.value = [...new Set((await routerSettingsApi.hub()).map((model) => routerString(model.model_group)).filter(Boolean))].sort();
	} catch {
		models.value = [];
	}
});
function save() {
	const incomplete = groups.value.filter((group) => !group.primary || !group.models.length);
	if (incomplete.length) {
		message.error("Please complete configuration for all groups. " + incomplete.length + " group(s) incomplete.");
		return;
	}
	emit(
		"save",
		groups.value.map((group) => ({ [group.primary]: [...group.models] })),
	);
}
</script>
<template>
	<UiDialog
		v-model:open="open"
		:width="900"
		:show-footer="false"
		:mask-closable="false"
		scroll-mode="overlay"
		class="routing-fallback-dialog"
		aria-label="Configure Model Fallbacks"
		><template #title
			><div class="routing-fallback-dialog-title">
				<div><UiLucideIcon name="ArrowRight" :size="20" /></div>
				<section>
					<h2>Configure Model Fallbacks</h2>
					<p>Manage multiple fallback chains for different models (up to 5 groups at a time)</p>
				</section>
			</div></template
		>
		<div class="routing-fallback-dialog-content">
			<FallbackGroupEditor v-model="groups" :models="models" />
			<footer>
				<UiButton :disabled="pending" @click="open = false">Cancel</UiButton
				><UiButton :loading="pending" :disabled="!groups.length || pending" @click="save">{{
					pending ? "Saving Configuration..." : "Save All Configurations"
				}}</UiButton>
			</footer>
		</div></UiDialog
	>
</template>
