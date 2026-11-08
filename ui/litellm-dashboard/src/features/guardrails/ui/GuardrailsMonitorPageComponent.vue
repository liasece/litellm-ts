<script setup lang="ts">
import { computed, ref } from "vue";
import AdvancedDatePickerComponent from "../../date-range/ui/AdvancedDatePickerComponent.vue";
import { localDateString } from "../../date-range/logic/DateRangeLogic";
import type { DateRangeValue } from "../../date-range/support/DateRangeModels";
import MonitorOverviewComponent from "./monitor/MonitorOverviewComponent.vue";
import MonitorDetailComponent from "./monitor/MonitorDetailComponent.vue";
import "../styles/GuardrailsMonitorStyles.css";
const end = new Date(),
	start = new Date();
start.setDate(start.getDate() - 7);
const date = ref<DateRangeValue>({ from: start, to: end }),
	selected = ref(""),
	startDate = computed(() => (date.value.from ? localDateString(date.value.from) : "")),
	endDate = computed(() => (date.value.to ? localDateString(date.value.to) : ""));
</script>
<template>
	<main class="guardrails-monitor-page">
		<div class="monitor-date-row"><AdvancedDatePickerComponent v-model="date" label="" :show-time-range="false" /></div>
		<MonitorOverviewComponent
			v-if="!selected"
			:start-date="startDate"
			:end-date="endDate"
			@select="selected = $event"
		/><MonitorDetailComponent
			v-else
			:key="selected"
			:guardrail-id="selected"
			:start-date="startDate"
			:end-date="endDate"
			@back="selected = ''"
		/>
	</main>
</template>
