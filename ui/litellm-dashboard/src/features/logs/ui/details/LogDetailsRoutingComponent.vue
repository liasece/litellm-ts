<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { routingView, routingReasonLabels, routingTypeLabels } from "../../logic/LogDetailsRoutingLogic";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import LogDetailsCollapseComponent from "./LogDetailsCollapseComponent.vue";
const props = defineProps<{ log: LogEntry }>();
const view = computed(() => routingView(props.log));
</script>
<template>
	<LogDetailsCollapseComponent v-if="view.visible" label="Routing"
		><template #label
			><div class="ld-inline">
				<h3>Routing</h3>
				<UiTag v-if="view.count" color="orange">{{ view.count }} fallback{{ view.count === 1 ? "" : "s" }}</UiTag>
			</div></template
		>
		<div class="ld-routing" data-testid="routing-details">
			<div class="ld-routing__original">
				<span class="ld-routing__caption">Original request</span><code>{{ view.originalModel }}</code>
				<div v-if="view.original.length" class="ld-routing__resolution">Resolution: {{ view.original.join(" → ") }}</div>
			</div>
			<div v-for="hop in view.hops" :key="hop.index" class="ld-routing__hop">
				<div class="ld-inline">
					<strong>Hop {{ hop.index }}</strong
					><UiTag v-if="hop.trace" color="blue">{{ routingTypeLabels[hop.trace.routing_type] }}</UiTag>
				</div>
				<div class="ld-routing__path">
					<code>{{ hop.from }}</code
					><UiIcon name="ArrowRightOutlined" /><code>{{ hop.to }}</code>
				</div>
				<div v-if="hop.path.length > 1" class="ld-routing__resolution">Resolution: {{ hop.path.join(" → ") }}</div>
				<div v-if="hop.trace?.attempted_deployment" class="ld-routing__resolution">
					Failed upstream: <code>{{ hop.trace.attempted_deployment }}</code>
				</div>
				<div class="ld-routing__error">
					<template v-if="hop.trace"
						><div class="ld-inline">
							<UiTag color="red">{{ routingReasonLabels[hop.trace.reason] }}</UiTag
							><span class="ld-secondary"
								>{{ hop.trace.error_information.error_type
								}}{{
									hop.trace.error_information.error_code !== null ? " · " + hop.trace.error_information.error_code : ""
								}}</span
							>
						</div>
						<div>{{ hop.trace.error_information.error_message }}</div></template
					><span v-else class="ld-secondary">Fallback reason and error were not recorded for this log.</span>
				</div>
			</div>
			<div class="ld-routing__final" :class="{ 'ld-routing__final--failed': log.metadata?.status === 'failure' }">
				<div class="ld-inline">
					<UiIcon :name="log.metadata?.status === 'failure' ? 'ExclamationCircleOutlined' : 'CheckCircleOutlined'" /><strong>{{
						log.metadata?.status === "failure" ? "Final attempted upstream" : "Final upstream model"
					}}</strong>
				</div>
				<code>{{ log.model }}</code>
			</div>
		</div></LogDetailsCollapseComponent
	>
</template>
