<script setup lang="ts">
import { computed } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { collectProviderStatusWarnings } from "../logic/ProviderStatusWarningLogic";
import type { LogEntry } from "../support/LogsModels";
const props = defineProps<{ logs: LogEntry[] }>();
const warnings = computed(() => collectProviderStatusWarnings(props.logs));
function time(date: Date) {
	return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
</script>
<template>
	<div v-if="warnings.length" class="logs-provider-warnings" aria-label="Provider service warnings">
		<UiAlert
			v-for="warning in warnings"
			:key="warning.provider"
			:data-testid="'provider-status-warning-' + warning.provider"
			type="warning"
			><template #title
				><span class="logs-provider-warning-title"
					><ProviderLogo
						:provider="getProviderLogoAndName(warning.provider).displayName"
						:logo="getProviderLogoAndName(warning.provider).logo"
					/>{{ warning.displayName }} may be experiencing a service issue</span
				></template
			>
			<div class="logs-provider-warning-description">
				{{ warning.errorCount }} recent request{{ warning.errorCount === 1 ? "" : "s" }} returned server errors ({{
					warning.errorCodes.join(", ")
				}}). Latest at {{ time(warning.latestErrorAt) }}.
			</div>
			<template v-if="warning.statusPageUrl" #action>
				<a class="logs-provider-warning-link" :href="warning.statusPageUrl" target="_blank" rel="noopener noreferrer"
					><ProviderLogo
						:provider="getProviderLogoAndName(warning.provider).displayName"
						:logo="getProviderLogoAndName(warning.provider).logo"
					/>View {{ warning.displayName }} status</a
				>
			</template></UiAlert
		>
	</div>
</template>
<style>
.logs-provider-warnings {
	margin-bottom: 16px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.logs-provider-warnings .ui-alert {
	position: relative;
}
.logs-provider-warning-title {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}
.logs-provider-warning-link {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	align-items: center;
	justify-content: center;
	height: 24px;
	border: 1px solid transparent;
	white-space: nowrap;
	color: #1677ff;
	text-decoration: none;
	font-size: 14px;
	line-height: 22px;
	padding: 0 7px;
}
.logs-provider-warning-link:hover {
	color: #69b1ff;
}
</style>
