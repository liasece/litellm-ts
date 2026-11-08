<script setup lang="ts">
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
withDefaults(
	defineProps<{ fetching: boolean; cancelled: boolean; progress: { currentPage: number; totalPages: number }; agent?: boolean }>(),
	{ agent: false },
);
const emit = defineEmits<{ cancel: [] }>(),
	href = window.location.href;
</script>
<template>
	<UiAlert v-if="fetching" type="warning" class="usage-progress"
		><div>
			<span
				><UiIcon name="LoadingOutlined" spin />Currently fetching {{ agent ? "agent" : "spend" }} data: fetched
				{{ progress.currentPage }} / {{ progress.totalPages }} pages. Charts will update periodically as data loads. Moving off of
				this page will stop and reset this. To continue using the UI in the meantime,
				<a :href="href" target="_blank" rel="noopener noreferrer">open a new tab <UiIcon name="ExportOutlined" /></a>.</span
			><UiButton variant="primary" danger @click="emit('cancel')">Stop</UiButton>
		</div></UiAlert
	><UiAlert v-if="cancelled" type="info" class="usage-progress"
		>Showing partial {{ agent ? "agent " : "" }}data ({{ progress.currentPage }}/{{ progress.totalPages }} pages loaded)</UiAlert
	>
</template>
