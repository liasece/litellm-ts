<script setup lang="ts">
import { computed } from "vue";
import HighlightedCodeComponent from "../../content/ui/HighlightedCodeComponent.vue";
import { substituteProxyUrl } from "../logic/ApiReferenceLogic";
import type { ApiReferenceExample } from "../support/ApiReferenceModels";
const props = defineProps<{ example: ApiReferenceExample; baseUrl: string }>();
const code = computed(() => substituteProxyUrl(props.example.code, props.baseUrl));
function replaceText(value: string) {
	return substituteProxyUrl(value, props.baseUrl);
}
</script>
<template><HighlightedCodeComponent :code="code" :tree="example.tree" :replace-text="replaceText" /></template>
