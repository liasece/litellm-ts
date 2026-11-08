<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { ADVANCED_MANAGEMENT_RESOURCES } from "../support/ManagementResources";
import type { CliProxyStore } from "../stores/CliProxyStore";
const props = defineProps<{ store: CliProxyStore }>();
const state = props.store.state;
const bodyPlaceholder = '{"value": true}';
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ value, label: value }));
const resources = ADVANCED_MANAGEMENT_RESOURCES.map((item) => ({ value: item.value, label: item.label + " (" + item.value + ")" }));
const result = computed(() =>
	state.managementResult === null ? "No request has been executed." : JSON.stringify(state.managementResult, null, 2),
);
</script>
<template>
	<div class="cp-stack cp-gap-8">
		<UiAlert title="Protected CLIProxy management console" class="cp-alert-with-description"
			>Requests are authenticated by LiteLLM, restricted to proxy_admin, and forwarded only to an explicit allowlist. Runtime config
			changes are synchronized back into LiteLLM and reloaded automatically. The child process API key and raw generated config are
			never exposed.</UiAlert
		>
		<UiCard appearance="antd" size="small" title="Management request" class="cp-card cp-card-small"
			><div class="cp-stack cp-gap-16">
				<div class="cp-management-row">
					<UiSelect v-model="state.managementMethod" :options="methods" /><UiSelect
						v-model="state.managementResource"
						searchable
						:options="resources"
					/>
				</div>
				<UiInput v-model="state.managementResource" placeholder="/request-error-logs/example.log" /><UiInput
					v-model="state.managementBody"
					multiline
					:rows="5"
					:auto-size="{ minRows: 5, maxRows: 16 }"
					:disabled="state.managementMethod === 'GET'"
					class="cp-mono"
					:spellcheck="false"
					:placeholder="bodyPlaceholder"
				/>
				<div>
					<UiButton
						variant="primary"
						:loading="state.busy === 'management request'"
						:disabled="state.busy !== null && state.busy !== 'management request'"
						@click="store.executeManagementRequest"
						>Execute</UiButton
					>
				</div>
			</div></UiCard
		>
		<UiCard appearance="antd" size="small" title="Response" class="cp-card cp-card-small">
			<pre class="cp-terminal cp-management-result">{{ result }}</pre>
		</UiCard>
	</div>
</template>
