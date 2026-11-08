<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { createPublicModelHubGateStore } from "../stores/PublicModelHubGateStore";
import PublicModelHubBodyComponent from "./public/PublicModelHubBodyComponent.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import "./ModelHubStyles.css";
const route = useRoute(),
	table = computed(() => route.path.replace(/\/$/, "").endsWith("/model_hub_table")),
	key = ref(typeof route.query.key === "string" ? route.query.key : null),
	gate = createPublicModelHubGateStore((url) => window.location.replace(url));
watch(
	() => route.query.key,
	(value) => {
		if (typeof value === "string" && value) key.value = value;
	},
);
watch(
	[table, key],
	([isTable]) => {
		if (isTable) void gate.load(Boolean(key.value));
	},
	{ immediate: true },
);
onBeforeUnmount(gate.dispose);
</script>
<template>
	<PublicModelHubBodyComponent v-if="!table || (gate.state.ready && gate.state.allowed)" />
	<UiCard v-else-if="gate.state.ready" appearance="tremor" class="hub-public-disabled"
		><h1>Public Model Hub not enabled.</h1>
		<p>Ask your proxy admin to enable this on their Admin UI.</p></UiCard
	>
</template>
