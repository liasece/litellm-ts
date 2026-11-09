<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import ModelLogo from "../../../providers/ui/ModelLogoComponent.vue";
import ProviderLogo from "../../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import { modelIdentity } from "../../logic/LogsPresentationLogic";
import { detailDate, relativeDetailDate } from "../../logic/LogDetailsDisplayLogic";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import LogDetailsCopyComponent from "./LogDetailsCopyComponent.vue";
const props = defineProps<{ log: LogEntry; inProgress: boolean }>();
defineEmits<{ close: []; next: []; previous: []; refresh: [] }>();
const model = computed(() => modelIdentity(props.log));
const providerName = computed(() => {
	const source = model.value.provider || props.log.custom_llm_provider;
	return source ? getProviderLogoAndName(source).displayName : "";
});
</script>
<template>
	<header class="ld-header">
		<div class="ld-header__model">
			<ProviderLogo v-if="model.toolLogo" :provider="model.displayName" :logo="model.toolLogo" />
			<ModelLogo
				v-else-if="model.executed || model.provider"
				:model="model.executed"
				:family="model.family"
				:provider="model.provider"
				:size="28"
			/><strong>{{ log.model }}</strong
			><span v-if="providerName" class="ld-secondary">{{ providerName }}</span>
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
