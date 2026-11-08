<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { getModelLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import { detailDate, relativeDetailDate } from "../../logic/LogDetailsDisplayLogic";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import LogDetailsCopyComponent from "./LogDetailsCopyComponent.vue";
const props = defineProps<{ log: LogEntry; inProgress: boolean }>();
defineEmits<{ close: []; next: []; previous: []; refresh: [] }>();
const provider = computed(() =>
	props.log.custom_llm_provider ? getModelLogoAndName(props.log.custom_llm_provider, props.log.model ?? "") : null,
);
function imageFailed(event: Event) {
	if (event.target instanceof HTMLElement) event.target.style.display = "none";
}
</script>
<template>
	<header class="ld-header">
		<div class="ld-header__model">
			<img
				v-if="provider?.logo"
				:src="provider.logo"
				:alt="provider.displayName || 'Provider'"
				width="24"
				height="24"
				@error="imageFailed"
			/><strong>{{ log.model }}</strong
			><span v-if="provider?.displayName" class="ld-secondary">{{ provider.displayName }}</span>
		</div>
		<div class="ld-header__request">
			<span class="ld-header__request-id" :title="log.request_id"
				>{{ log.request_id }}<LogDetailsCopyComponent :text="log.request_id" label="Copy Request ID"
			/></span>
			<div class="ld-header__navigation">
				<UiButton variant="text" size="small" title="Refresh log details" aria-label="Refresh log details" @click="$emit('refresh')"
					><UiIcon name="ReloadOutlined" /></UiButton
				><span class="ld-header__divider" /><UiButton
					variant="text"
					size="small"
					aria-label="Previous log"
					@click="$emit('previous')"
					><UiIcon name="UpOutlined" /><kbd>K</kbd></UiButton
				><span class="ld-header__divider" /><UiButton variant="text" size="small" aria-label="Next log" @click="$emit('next')"
					><UiIcon name="DownOutlined" /><kbd>J</kbd></UiButton
				><span class="ld-header__divider" /><UiButton
					variant="text"
					title="ESC to close"
					aria-label="Close log details"
					@click="$emit('close')"
					><UiIcon name="CloseOutlined"
				/></UiButton>
			</div>
		</div>
		<div class="ld-header__status">
			<UiTag :color="inProgress ? 'processing' : log.metadata?.status === 'failure' ? 'error' : 'success'">{{
				inProgress ? "In Progress" : log.metadata?.status === "failure" ? "Failure" : "Success"
			}}</UiTag
			><UiTag>Env: {{ log.metadata?.user_api_key_team_alias || "default" }}</UiTag
			><span class="ld-header__time"
				>{{ detailDate(log.startTime) }}<span>({{ relativeDetailDate(log.startTime) }})</span></span
			>
		</div>
	</header>
</template>
