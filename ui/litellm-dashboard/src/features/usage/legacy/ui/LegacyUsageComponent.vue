<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import LegacyCost from "./LegacyCostComponent.vue";
import LegacyActivity from "./LegacyActivityComponent.vue";
import LegacyTeams from "./LegacyTeamsComponent.vue";
import LegacyCustomer from "./LegacyCustomerComponent.vue";
import LegacyTags from "./LegacyTagsComponent.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createdKeyChoices } from "../../../virtual-keys/stores/CreatedKeysHistoryStore";
import { legacyAdmin } from "../logic/LegacyUsageDataLogic";
import { createLegacyUsageStore } from "../stores/LegacyUsageStore";
import type { DateRangeValue } from "../../../date-range/support/DateRangeModels";
import "../styles/LegacyUsageStyles.css";
const auth = useAuthenticationStore(),
	tab = ref("all"),
	allTab = ref("cost"),
	tags = ref<string[]>(["all-tags"]),
	range = ref<DateRangeValue>({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() });
const store = createLegacyUsageStore(auth.userRole.value),
	data = store.state,
	keys = computed(() => createdKeyChoices(auth.state.session?.user_id || ""));
const items = computed(() => [
	{ key: "all", label: "All Up" },
	...(legacyAdmin(auth.userRole.value)
		? [
				{ key: "teams", label: "Team Based Usage" },
				{ key: "customers", label: "Customer Usage" },
				{ key: "tags", label: "Tag Based Usage" },
			]
		: []),
]);
function dates() {
	void store.tags(range.value, tags.value);
	void store.initialize(range.value);
}
watch(range, dates, { deep: true });
watch(tags, () => void store.tags(range.value, tags.value), { deep: true });
onMounted(dates);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="legacy-usage-page">
		<UiCard v-if="data.settings.DISABLE_EXPENSIVE_DB_QUERIES" appearance="tremor" class="legacy-query-limit"
			><h3>Database Query Limit Reached</h3>
			<p>
				SpendLogs in DB has {{ data.settings.NUM_SPEND_LOGS_ROWS }} rows.<br />Please follow our guide to view usage when SpendLogs
				has more than 1M rows.
			</p>
			<UiButton appearance="tremor" variant="primary"
				><a href="https://docs.litellm.ai/docs/proxy/spending_monitoring" target="_blank" rel="noreferrer"
					>View Usage Guide</a
				></UiButton
			></UiCard
		><UiTabs v-else v-model="tab" appearance="tremor" :items="items" class="legacy-usage-tabs"
			><UiTabs
				v-if="tab === 'all'"
				v-model="allTab"
				appearance="tremor"
				:items="[
					{ key: 'cost', label: 'Cost' },
					{ key: 'activity', label: 'Activity' },
				]"
				class="legacy-cost-tabs"
				><LegacyCost v-if="allTab === 'cost'" :data="data" /><LegacyActivity v-else :data="data" /></UiTabs
			><LegacyTeams v-else-if="tab === 'teams'" :data="data" /><LegacyCustomer
				v-else-if="tab === 'customers'"
				v-model:range="range"
				:rows="data.endUsers"
				:keys="keys"
				@change="store.endUsers($event, range)" /><LegacyTags
				v-else-if="tab === 'tags'"
				v-model:range="range"
				v-model:tags="tags"
				:rows="data.tags"
				:names="data.tagNames"
				:premium="Boolean(auth.state.session?.premium_user)"
		/></UiTabs>
	</div>
</template>
