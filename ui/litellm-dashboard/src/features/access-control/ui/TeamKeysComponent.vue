<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import VirtualKeysTableComponent from "../../virtual-keys/ui/VirtualKeysTableComponent.vue";
import KeyDetailDrawerComponent from "../../virtual-keys/ui/KeyDetailDrawerComponent.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiPagination from "../../platform/ui/UiPagination.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import { createVirtualKeysStore } from "../../virtual-keys/stores/VirtualKeysStore";
import { emptyKeyCatalog, type VirtualKey } from "../../virtual-keys/support/VirtualKeyModels";
import type { AccessTeam } from "../support/AccessModels";
const props = defineProps<{ team: AccessTeam }>();
const store = createVirtualKeysStore(),
	{ state } = store,
	catalog = shallowRef(emptyKeyCatalog()),
	selected = ref<VirtualKey | null>(null),
	detailOpen = ref(false),
	expanded = ref(false);
state.filters.team = props.team.team_id;
function select(key: VirtualKey) {
	selected.value = key;
	detailOpen.value = true;
}
function reset() {
	state.filters = { team: props.team.team_id, organization: "", alias: "", user: "", hash: "" };
	state.page = 1;
	void store.refresh();
}
onMounted(() => {
	void store.refresh();
	void store.catalog(props.team.team_id).then((value) => {
		catalog.value = value;
	});
	window.addEventListener("storage", store.refresh);
});
onBeforeUnmount(() => {
	window.removeEventListener("storage", store.refresh);
	store.dispose();
});
</script>
<template>
	<section class="access-team-keys">
		<AccessNoticeComponent :error="state.error" :message="state.message" />
		<div class="access-key-filter">
			<UiButton variant="text" @click="expanded = !expanded">Filters</UiButton
			><template v-if="expanded"
				><UiInput v-model="state.filters.organization" placeholder="Organization ID" /><UiInput
					v-model="state.filters.alias"
					placeholder="Key Alias"
				/><UiInput v-model="state.filters.user" placeholder="User ID" /><UiButton
					@click="
						state.page = 1;
						store.refresh();
					"
					>Apply</UiButton
				><UiButton @click="reset">Reset</UiButton></template
			>
		</div>
		<UiPagination
			:model-value="state.page"
			:total="state.total"
			:page-size="50"
			@change="store.page($event)"
		/><VirtualKeysTableComponent
			:rows="state.rows"
			:catalog="catalog"
			:loading="state.loading"
			:sort-by="state.sortBy"
			:sort-order="state.sortOrder"
			:can-modify="() => false"
			:pending-token="state.pendingToken"
			scope="team"
			@select="select"
			@sort="store.sort"
		/><KeyDetailDrawerComponent
			v-model:open="detailOpen"
			:key-data="selected"
			:catalog="catalog"
			@updated="store.refresh"
			@deleted="store.refresh"
		/>
	</section>
</template>
