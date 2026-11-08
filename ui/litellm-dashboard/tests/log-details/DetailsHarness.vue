<script setup lang="ts">
import { provide, ref } from "vue";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";
import LogDetailsDrawerComponent from "../../src/features/logs/ui/details/LogDetailsDrawerComponent.vue";
import type { LogEntry, SessionGroupRef } from "../../src/features/logs/support/LogsModels";
import { first, second, group } from "./Fixtures";
provide(priceDisplayStoreKey, createPriceDisplayStore());
const open = ref(false),
	selected = ref<LogEntry | null>(first),
	session = ref<SessionGroupRef | null>(null);
function show(withSession: boolean) {
	selected.value = first;
	session.value = withSession ? group : null;
	open.value = true;
}
</script>
<template>
	<button @click="show(false)">Open request</button><button @click="show(true)">Open session</button
	><LogDetailsDrawerComponent
		:open="open"
		:log="selected"
		:session-group="session"
		:all-logs="[first, second]"
		start-time="2026-11-07 00:00:00"
		:upstream-logs-enabled="true"
		@close="open = false"
		@select="selected = $event"
	/>
</template>
