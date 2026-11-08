<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { guardrailEntries, guardrailLabel, hasMessages, hasResponse, maskedEntityCount } from "../../logic/LogDetailsDisplayLogic";
import { asRecord, safeJsonStringify } from "../../logic/PrettyMessagesBlocksLogic";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import LogDetailsConfigInfoComponent from "./LogDetailsConfigInfoComponent.vue";
import LogDetailsCollapseComponent from "./LogDetailsCollapseComponent.vue";
import LogDetailsCopyComponent from "./LogDetailsCopyComponent.vue";
import LogDetailsTruncatedComponent from "./LogDetailsTruncatedComponent.vue";
import LogDetailsInfoComponent from "./LogDetailsInfoComponent.vue";
import LogDetailsRoutingComponent from "./LogDetailsRoutingComponent.vue";
import LogDetailsRequestResponseComponent from "./LogDetailsRequestResponseComponent.vue";
import LogDetailsVectorStoreComponent from "./LogDetailsVectorStoreComponent.vue";
import LogDetailsGuardrailComponent from "./guardrails/LogDetailsGuardrailComponent.vue";
const props = defineProps<{ log: LogEntry; loading: boolean; inProgress: boolean; upstreamLogsEnabled?: boolean }>();
defineEmits<{ "open-settings": [] }>();
const metadata = computed(() => props.log.metadata ?? {}),
	error = computed(() => (metadata.value.status === "failure" ? asRecord(metadata.value.error_information) : null)),
	entries = computed(() => guardrailEntries(metadata.value.guardrail_information));
const tags = computed(() => asRecord(props.log.request_tags) ?? {});
const missing = computed(
	() =>
		!hasMessages(props.log.messages) &&
		!hasResponse(props.log.response) &&
		metadata.value.status !== "failure" &&
		!props.inProgress &&
		!props.loading,
);
function jump() {
	document.getElementById("guardrail-section")?.scrollIntoView({ behavior: "smooth" });
}
</script>
<template>
	<div class="ld-content">
		<UiAlert v-if="error" type="error" title="Request Failed" class="ld-block-gap"
			><div v-if="error.error_code"><strong>Error Code:</strong> {{ error.error_code }}</div>
			<div v-if="error.error_message"><strong>Message:</strong> {{ error.error_message }}</div></UiAlert
		>
		<section v-if="Object.keys(tags).length" class="ld-tags ld-surface">
			<strong>Tags</strong>
			<div class="ld-inline ld-wrap">
				<UiTag v-for="(value, key) in tags" :key="key">{{ key }}: {{ String(value) }}</UiTag>
			</div>
		</section>
		<section class="ld-request-details ld-surface">
			<div class="ld-request-details__header">Request Details</div>
			<div class="ld-request-details__body ld-descriptions">
				<div>
					<span>Model</span><span>{{ log.model }}</span>
				</div>
				<div>
					<span>Provider</span><span>{{ log.custom_llm_provider || "-" }}</span>
				</div>
				<template v-if="metadata.internal_call_type === 'builtin_capability'"
					><div>
						<span>Built-in Capability</span><UiTag color="purple">{{ String(metadata.builtin_capability || "unknown") }}</UiTag>
					</div>
					<div><span>Parent Request</span><LogDetailsTruncatedComponent :value="metadata.parent_request_id" /></div
				></template>
				<div>
					<span>Call Type</span><span>{{ log.call_type }}</span>
				</div>
				<div><span>Model ID</span><LogDetailsTruncatedComponent :value="log.model_id" /></div>
				<div><span>API Base</span><LogDetailsTruncatedComponent :value="log.api_base" :max-width="300" /></div>
				<div v-if="log.requester_ip_address">
					<span>IP Address</span><span>{{ log.requester_ip_address }}</span>
				</div>
				<div v-if="entries.length">
					<span>Guardrail</span
					><span class="ld-inline"
						><button class="ld-link" @click="jump">{{ guardrailLabel(entries) }}</button
						><UiTag v-if="maskedEntityCount(entries) > 0" color="blue">{{ maskedEntityCount(entries) }} masked</UiTag></span
					>
				</div>
			</div>
		</section>
		<LogDetailsRoutingComponent :log="log" /><LogDetailsInfoComponent :log="log" :in-progress="inProgress" />
		<LogDetailsConfigInfoComponent v-if="missing" @open-settings="$emit('open-settings')" />
		<div v-if="loading" class="ld-loading ld-surface">
			<UiSpinner />
			<div>Loading request &amp; response data...</div>
		</div>
		<LogDetailsRequestResponseComponent
			v-else
			:log="log"
			:upstream-logs-enabled="upstreamLogsEnabled"
			@open-settings="$emit('open-settings')"
		/>
		<div v-if="entries.length" id="guardrail-section"><LogDetailsGuardrailComponent :entries="entries" :log="log" /></div>
		<LogDetailsVectorStoreComponent :data="metadata.vector_store_request_metadata" />
		<LogDetailsCollapseComponent v-if="Object.keys(metadata).length" label="Metadata"
			><div class="ld-metadata-copy"><LogDetailsCopyComponent :text="safeJsonStringify(metadata, true)" label="Copy Metadata" /></div>
			<pre class="ld-metadata">{{ safeJsonStringify(metadata, true) }}</pre>
		</LogDetailsCollapseComponent>
		<div style="height: 24px" />
	</div>
</template>
