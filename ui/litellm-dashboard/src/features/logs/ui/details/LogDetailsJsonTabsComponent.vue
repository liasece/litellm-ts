<script setup lang="ts">
import UiTabs from "../../../platform/ui/UiTabs.vue";
import JsonContent from "../../../content/ui/JsonContent.vue";
import LogDetailsCopyComponent from "./LogDetailsCopyComponent.vue";
import { safeJsonStringify } from "../../logic/PrettyMessagesBlocksLogic";
withDefaults(defineProps<{ modelValue: string; request: unknown; response: unknown; hasResponse: boolean }>(), { modelValue: "request" });
defineEmits<{ "update:modelValue": [value: string] }>();
const tabs = [
	{ key: "request", label: "Request" },
	{ key: "response", label: "Response" },
];
</script>
<template>
	<UiTabs :model-value="modelValue" :items="tabs" @update:model-value="$emit('update:modelValue', $event)"
		><template #extra
			><LogDetailsCopyComponent
				:text="safeJsonStringify(modelValue === 'request' ? request : response, true)"
				label="Copy JSON"
				:disabled="modelValue === 'response' && !hasResponse" /></template
	></UiTabs>
	<div class="ld-json-body">
		<JsonContent
			v-if="modelValue === 'request' ? Boolean(request) : hasResponse"
			:value="modelValue === 'request' ? request : response"
		/>
		<div v-else class="ld-no-data">{{ modelValue === "request" ? "Request" : "Response" }} data not available</div>
	</div>
</template>
