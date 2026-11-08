<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDrawer from "../../platform/ui/UiDrawer.vue";
import { loadKeyCatalog } from "../data/KeyCatalogData";
import { canModifyVirtualKey } from "../logic/KeyPermissionLogic";
import { emptyKeyCatalog, type KeyCatalog, type VirtualKey } from "../support/VirtualKeyModels";
import KeyDetailContent from "./KeyDetailContentComponent.vue";
const open = defineModel<boolean>("open", { required: true });
const props = defineProps<{ keyData: VirtualKey | null; catalog?: KeyCatalog; backButtonText?: string; embedded?: boolean }>();
const emit = defineEmits<{ updated: [response: Record<string, unknown>]; deleted: [token: string]; close: [] }>();
const auth = useAuthenticationStore();
const details = ref<InstanceType<typeof KeyDetailContent>>();
const ownCatalog = ref(emptyKeyCatalog());
const catalog = computed(() => props.catalog ?? ownCatalog.value);
const canModify = computed(
	() => props.keyData && canModifyVirtualKey(props.keyData, auth.userRole.value, auth.state.session?.user_id || "", catalog.value.teams),
);
watch(
	open,
	async (value) => {
		if (value && !props.catalog) ownCatalog.value = await loadKeyCatalog();
	},
	{ immediate: true },
);
function close() {
	open.value = false;
	emit("close");
}
function deleted(token: string) {
	emit("deleted", token);
	close();
}
</script>
<template>
	<section v-if="embedded && open">
		<KeyDetailContent
			v-if="keyData"
			ref="details"
			:key-data="keyData"
			:catalog="catalog"
			:back-button-text="backButtonText"
			@updated="emit('updated', $event)"
			@deleted="deleted"
			@close="close"
		/><UiAlert v-else type="error">Key not found</UiAlert>
	</section>
	<UiDrawer
		v-else
		v-model:open="open"
		:title="'Virtual Key: ' + (keyData?.key_alias || 'Virtual Key')"
		class="vk-detail-drawer"
		@close="emit('close')"
	>
		<template #title
			><div class="vk-drawer-heading">
				<div>
					<h2>Virtual Key: {{ keyData?.key_alias || "Virtual Key" }}</h2>
					<p>{{ keyData?.token_id || keyData?.token }}</p>
				</div>
				<UiButton v-if="canModify" appearance="tremor" variant="primary" @click="details?.edit()">Edit</UiButton>
			</div></template
		>
		<KeyDetailContent
			v-if="open && keyData"
			ref="details"
			:key-data="keyData"
			:catalog="catalog"
			@updated="emit('updated', $event)"
			@deleted="deleted"
		/><UiAlert v-else-if="open" type="error">Key not found</UiAlert>
	</UiDrawer>
</template>
