<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
defineProps<{ title: string; description: string; icon: string; serverName?: string }>();
const enabled = ref(false);
</script>
<template>
	<UiCard appearance="antd" class="tools-mcp-feature-card"
		><header>
			<span><UiLucideIcon :name="icon" :size="16" /></span>
			<div>
				<h5>{{ title }}</h5>
				<p>{{ description }}</p>
			</div>
		</header>
		<div v-if="serverName && (title === 'Implementation Example' || title === 'Configuration')" class="tools-mcp-header-toggle">
			<div>
				<UiSwitch v-model="enabled" size="small" /><span
					>Limit tools to specific MCP servers or MCP groups by passing the <code>x-mcp-servers</code> header</span
				>
			</div>
			<UiAlert v-if="enabled" type="info" title="Two Options" show-icon
				><p>
					<strong>Option 1:</strong> Get a specific server: <code>&quot;{{ serverName.replace(/\s+/g, "_") }}&quot;</code>
				</p>
				<p><strong>Option 2:</strong> Get a group of MCPs: <code>&quot;dev-group&quot;</code></p>
				<p>You can also mix both: <code>&quot;Server1,dev-group&quot;</code></p></UiAlert
			>
		</div>
		<slot :enabled="enabled"
	/></UiCard>
</template>
