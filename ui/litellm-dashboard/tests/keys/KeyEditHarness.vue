<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../src/features/platform/ui/UiButton.vue";
import UiDialog from "../../src/features/platform/ui/UiDialog.vue";
import KeyEditForm from "../../src/features/virtual-keys/ui/KeyEditFormComponent.vue";
import NotificationLayer from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
import { emptyKeyCatalog, type VirtualKey } from "../../src/features/virtual-keys/support/VirtualKeyModels";
const open = ref(false),
	pending = ref(false),
	saves = ref(0),
	lastPayload = ref<Record<string, unknown>>({});
const key: VirtualKey = {
	token: "fixture-key",
	key_alias: "Fixture Key",
	models: [],
	metadata: { owner: "synthetic fixture" },
	max_budget: 100,
	budget_duration: "30d",
};
const catalog = emptyKeyCatalog();
function show(busy = false) {
	pending.value = busy;
	open.value = true;
}
</script>
<template>
	<UiButton @click="show()">Open key edit</UiButton><UiButton @click="show(true)">Open busy key edit</UiButton>
	<UiDialog
		v-model:open="open"
		title="Edit Virtual Key"
		width="min(960px,100vw)"
		:show-footer="false"
		scroll-mode="overlay"
		class="vk-edit-modal"
	>
		<KeyEditForm
			v-if="open"
			:key-data="key"
			:catalog="catalog"
			:pending="pending"
			@save="
				lastPayload = $event;
				saves++;
			"
			@cancel="open = false"
		/>
	</UiDialog>
	<output data-testid="key-saves">{{ saves }}</output
	><output data-testid="key-budget-duration">{{ lastPayload.budget_duration }}</output
	><NotificationLayer />
</template>
