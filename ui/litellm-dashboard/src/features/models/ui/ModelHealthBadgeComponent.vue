<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import type { ModelHealthStatus } from "../support/ModelModels";
defineProps<{ status?: ModelHealthStatus; modelId: string }>();
defineEmits<{ check: []; detail: [] }>();
</script>
<template>
	<div class="model-health-badge">
		<UiTag
			appearance="tremor"
			:color="status?.loading ? 'blue' : status?.status === 'healthy' ? 'emerald' : status?.status === 'unhealthy' ? 'red' : 'gray'"
		>
			{{ status?.loading ? "checking" : status?.status || "none" }}
		</UiTag>
		<button
			class="model-icon-button model-health-refresh"
			aria-label="Refresh health status"
			:disabled="status?.loading"
			@click.stop="$emit('check')"
		>
			<UiIcon name="SyncOutlined" :size="12.4" :spin="status?.loading" />
		</button>
	</div>
</template>
