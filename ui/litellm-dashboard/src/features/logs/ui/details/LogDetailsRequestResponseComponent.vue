<script setup lang="ts">
import { computed, ref } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { asRecord } from "../../logic/PrettyMessagesBlocksLogic";
import { formatData, downstreamRequest, hasResponse } from "../../logic/LogDetailsDisplayLogic";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import LogDetailsCollapseComponent from "./LogDetailsCollapseComponent.vue";
import LogDetailsJsonTabsComponent from "./LogDetailsJsonTabsComponent.vue";
import LogDetailsDiffComponent from "./LogDetailsDiffComponent.vue";
import PrettyMessagesComponent from "./PrettyMessagesComponent.vue";
const props = defineProps<{ log: LogEntry; upstreamLogsEnabled?: boolean }>();
defineEmits<{ "open-settings": [] }>();
const source = ref("downstream"),
	view = ref("pretty"),
	activeTab = ref("request");
let lastProxy: unknown = Symbol(),
	lastMessages: unknown = Symbol(),
	lastRaw: unknown,
	lastRecorded: unknown;
const raw = computed(() => {
	const proxy = props.log.proxy_server_request,
		messages = props.log.messages;
	if (proxy !== lastProxy || messages !== lastMessages) {
		lastProxy = proxy;
		lastMessages = messages;
		lastRaw = downstreamRequest(proxy, messages, true);
		lastRecorded = downstreamRequest(proxy, messages, false);
	}
	return { raw: lastRaw, recorded: lastRecorded };
});
const upstream = computed(() => {
	const proxy = asRecord(formatData(props.log.proxy_server_request));
	return { request: formatData(proxy?.upstream_request), response: formatData(proxy?.upstream_response) };
});
const downstreamResponse = computed(() => {
	const error = asRecord(props.log.metadata?.error_information);
	return props.log.metadata?.status === "failure" && error
		? {
				error: {
					message: error.error_message || "An error occurred",
					type: error.error_class || "error",
					code: error.error_code || "unknown",
					param: null,
				},
			}
		: formatData(props.log.response);
});
const responsePresent = computed(() => hasResponse(props.log.response) || props.log.metadata?.status === "failure");
const hasUpstream = computed(() => Boolean(upstream.value.request || upstream.value.response));
const tabs = computed(() => [
	{ key: "downstream", label: "Downstream" },
	{ key: "upstream", label: "Upstream" },
	...(raw.value.recorded && upstream.value.request ? [{ key: "diff", label: "Diff" }] : []),
]);
const metrics = computed(() => {
	const prompt = props.log.prompt_tokens || 0,
		completion = props.log.completion_tokens || 0,
		total = prompt + completion,
		spend = props.log.spend ?? 0,
		costs = asRecord(props.log.metadata?.cost_breakdown);
	const useCosts = typeof costs?.input_cost === "number" && typeof costs?.output_cost === "number";
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		input_cost: useCosts ? Number(costs.input_cost) : total > 0 ? (spend * prompt) / total : 0,
		output_cost: useCosts ? Number(costs.output_cost) : total > 0 ? (spend * completion) / total : 0,
	};
});
</script>
<template>
	<LogDetailsCollapseComponent label="Request &amp; Response" default-open
		><template #label
			><div class="ld-request-heading">
				<h3>Request &amp; Response</h3>
				<div v-if="source === 'downstream'" class="ld-radio-group" role="group" aria-label="Request response view" @click.stop>
					<button
						v-for="mode in ['pretty', 'json']"
						:key="mode"
						type="button"
						:class="{ 'ld-radio--active': view === mode }"
						:aria-pressed="view === mode"
						@click="view = mode"
					>
						{{ mode === "pretty" ? "Pretty" : "JSON" }}
					</button>
				</div>
			</div></template
		>
		<UiTabs v-model="source" :items="tabs" />
		<template v-if="source === 'downstream'"
			><PrettyMessagesComponent
				v-if="view === 'pretty'"
				:request="raw.raw"
				:meta-request="upstream.request"
				:response="downstreamResponse"
				:metrics="metrics" /><LogDetailsJsonTabsComponent
				v-else
				v-model="activeTab"
				:request="raw.raw"
				:response="downstreamResponse"
				:has-response="responsePresent"
		/></template>
		<template v-else-if="source === 'upstream'"
			><LogDetailsJsonTabsComponent
				v-if="hasUpstream"
				v-model="activeTab"
				:request="upstream.request"
				:response="upstream.response"
				:has-response="Boolean(upstream.response)"
			/><UiAlert v-else-if="upstreamLogsEnabled === true" type="info" title="This request has no recorded upstream details"
				>Upstream log details are already enabled, so new requests record the provider exchange. This entry has none: it was written
				before that setting was turned on, or the provider call never completed. Check the matching audit entry for the provider
				response.</UiAlert
			><UiAlert v-else type="info" title="Upstream request and response details are not available"
				><template v-if="upstreamLogsEnabled === false"
					>Enable upstream log details in Spend Logs Settings to record future provider exchanges.
					<UiButton variant="link" style="padding: 0; margin-left: 4px" @click="$emit('open-settings')"
						>Open settings</UiButton
					></template
				><template v-else>Upstream request and response details were not recorded for this exchange.</template></UiAlert
			></template
		>
		<LogDetailsDiffComponent
			v-else-if="source === 'diff'"
			:downstream-request="raw.recorded"
			:upstream-request="upstream.request"
			:downstream-response="downstreamResponse"
			:upstream-response="asRecord(upstream.response)?.body ?? null"
		/>
	</LogDetailsCollapseComponent>
</template>
