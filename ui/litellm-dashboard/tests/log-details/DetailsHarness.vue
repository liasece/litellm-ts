<script setup lang="ts">
import { provide, ref } from "vue";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";
import LogDetailsDrawerComponent from "../../src/features/logs/ui/details/LogDetailsDrawerComponent.vue";
import type { LogEntry, SessionGroupRef } from "../../src/features/logs/support/LogsModels";
import { cooldown, first, second, sessionFirst } from "./Fixtures";
import { navigableSessionGroup } from "../../src/features/logs/logic/LogsIdentityLogic";
provide(priceDisplayStoreKey, createPriceDisplayStore());
const open = ref(false),
	selected = ref<LogEntry | null>(first),
	session = ref<SessionGroupRef | null>(null);
// 与真实页面一致：会话分组由选中的那一行推导，切换日志后会跟着换组。
function show(withSession: boolean) {
	select(withSession ? sessionFirst : first);
	open.value = true;
}
function select(log: LogEntry) {
	selected.value = log;
	session.value = navigableSessionGroup(log);
}
function showCooldown() {
	selected.value = cooldown;
	session.value = null;
	open.value = true;
}
</script>
<template>
	<button @click="show(false)">Open request</button><button @click="show(true)">Open session</button
	><button @click="showCooldown()">Open cooldown</button
	><LogDetailsDrawerComponent
		:open="open"
		:log="selected"
		:session-group="session"
		:all-logs="[first, second]"
		start-time="2026-11-07 00:00:00"
		:upstream-logs-enabled="true"
		@close="open = false"
		@select="select"
	/>
</template>
