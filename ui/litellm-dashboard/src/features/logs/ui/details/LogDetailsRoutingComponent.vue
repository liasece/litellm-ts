<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { routingView, routingReasonLabels, routingTypeLabels } from "../../logic/LogDetailsRoutingLogic";
import ModelName from "../../../providers/ui/ModelNameComponent.vue";
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
				<span class="ld-routing__caption">Original request</span
				><ModelName class="ld-routing__model" :model="view.originalModel" :size="16" variant="code" />
				<div v-if="view.original.length" class="ld-routing__resolution ld-routing__chain">
					<span>Resolution:</span
					><template v-for="(name, index) in view.original" :key="index"
						><UiIcon v-if="index" name="ArrowRightOutlined" /><ModelName
							class="ld-routing__model"
							:model="name"
							:size="14"
							variant="code"
					/></template>
				</div>
			</div>
			<div v-for="hop in view.hops" :key="hop.index" class="ld-routing__hop">
				<div class="ld-inline">
					<strong>Hop {{ hop.index }}</strong
					><UiTag v-if="hop.trace" color="blue">{{ routingTypeLabels[hop.trace.routing_type] }}</UiTag>
				</div>
				<div class="ld-routing__path">
					<ModelName class="ld-routing__model" :model="hop.from" :size="16" variant="code" /><UiIcon
						name="ArrowRightOutlined"
					/><ModelName class="ld-routing__model" :model="hop.to" :size="16" variant="code" />
				</div>
				<div v-if="hop.path.length > 1" class="ld-routing__resolution ld-routing__chain">
					<span>Resolution:</span
					><template v-for="(name, index) in hop.path" :key="index"
						><UiIcon v-if="index" name="ArrowRightOutlined" /><ModelName
							class="ld-routing__model"
							:model="name"
							:size="14"
							variant="code"
					/></template>
				</div>
				<div v-if="hop.trace?.attempted_deployment" class="ld-routing__resolution">
					Failed upstream:
					<ModelName class="ld-routing__model" :model="hop.trace.attempted_deployment" :size="14" variant="code" />
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
				<ModelName class="ld-routing__model" :model="log.model" :provider="log.custom_llm_provider" :size="18" variant="code" />
			</div></div
	></LogDetailsCollapseComponent>
</template>
