<script setup lang="ts">
import { ref } from "vue";
import ToolPoliciesListComponent from "./tool-policies/ToolPoliciesListComponent.vue";
import ToolPolicyDetailComponent from "./tool-policies/ToolPolicyDetailComponent.vue";
import "../styles/GuardrailsMonitorStyles.css";
import "../styles/ToolPoliciesStyles.css";
const selected = ref("");
</script>
<template>
	<main class="tool-policies-page">
		<ToolPolicyDetailComponent v-if="selected" :key="selected" :tool-name="selected" @back="selected = ''" /><ToolPoliciesListComponent
			v-else
			@select="selected = $event"
		/>
	</main>
</template>
