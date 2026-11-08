<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import CacheAnalytics from "./CacheAnalyticsComponent.vue";
import CacheHealth from "./CacheHealthComponent.vue";
import CacheSettings from "./CacheSettingsComponent.vue";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import { cacheApi } from "../api/CacheApi";
import notification from "../../notifications/logic/NotificationManager";
import "./CacheStyles.css";
const tab = ref("analytics"),
	rows = ref<Record<string, unknown>[]>([]),
	keys = ref<string[]>([]),
	models = ref<string[]>([]),
	range = ref<DateRangeValue>({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() }),
	refreshed = ref("");
let generation = 0;
async function load() {
	const current = ++generation;
	refreshed.value = new Date().toLocaleString();
	try {
		const data = await cacheApi.activity(range.value.from, range.value.to);
		if (current === generation) rows.value = data;
	} catch (error) {
		notification.fromBackend(error);
	}
}
watch(range, load, { deep: true });
onMounted(load);
</script>
<template>
	<div class="cache-dashboard">
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'analytics', label: 'Cache Analytics' },
				{ key: 'health', label: 'Cache Health' },
				{ key: 'settings', label: 'Cache Settings' },
			]"
			><template #extra
				><div class="cache-last-refresh">
					<span v-if="refreshed">Last Refreshed: {{ refreshed }}</span
					><button type="button" aria-label="Refresh" @click="refreshed = new Date().toLocaleString()">
						<UiHeroIcon name="RefreshIcon" :size="12" />
					</button></div></template
			><CacheAnalytics
				v-if="tab === 'analytics'"
				v-model:keys="keys"
				v-model:models="models"
				v-model:range="range"
				:rows="rows" /><CacheHealth v-else-if="tab === 'health'" /><CacheSettings v-else
		/></UiTabs>
	</div>
</template>
