<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import McpSubmissionRulesComponent from "./McpSubmissionRulesComponent.vue";
import McpSubmissionCardComponent from "./McpSubmissionCardComponent.vue";
import McpReviewConfirmComponent from "./McpReviewConfirmComponent.vue";
import { createMcpSubmissionsStore } from "../stores/McpSubmissionsStore";
import "../styles/McpSubmissionsStyles.css";
const store = createMcpSubmissionsStore();
onMounted(store.load);
onBeforeUnmount(store.dispose);
const stats = [
	{ key: "total" as const, label: "Total Submitted", color: "gray" },
	{ key: "pending_review" as const, label: "Pending Review", color: "yellow" },
	{ key: "active" as const, label: "Active", color: "green" },
	{ key: "rejected" as const, label: "Rejected", color: "red" },
];
</script>
<template>
	<div class="tools-mcp-submissions">
		<McpSubmissionRulesComponent v-model="store.required.value" :saving="store.saving.value" :save="store.save" />
		<div class="tools-mcp-submission-stats">
			<section v-for="stat in stats" :key="stat.key">
				<strong :class="stat.color">{{ store.summary.value[stat.key] }}</strong
				><small>{{ stat.label }}</small>
			</section>
		</div>
		<div class="tools-mcp-submission-filters">
			<div><UiLucideIcon name="Search" :size="16" /><input v-model="store.search.value" placeholder="Search MCP servers..." /></div>
			<select v-model="store.status.value">
				<option value="all">All Status</option>
				<option value="pending_review">Pending Review</option>
				<option value="active">Active</option>
				<option value="rejected">Rejected</option>
			</select>
		</div>
		<p v-if="store.loading.value" class="tools-mcp-submission-empty">Loading submissions…</p>
		<p v-else-if="store.error.value" class="tools-mcp-submission-empty tools-error">{{ store.error.value }}</p>
		<p v-else-if="!store.filtered.value.length" class="tools-mcp-submission-empty">No MCP server submissions match your filters.</p>
		<McpSubmissionCardComponent
			v-for="server in store.filtered.value"
			v-else
			:key="server.server_id"
			:server="server"
			:required="store.required.value"
			@approve="store.confirm.value = { server, action: 'approve' }"
			@reject="store.confirm.value = { server, action: 'reject' }"
		/><McpReviewConfirmComponent
			v-if="store.confirm.value"
			:server="store.confirm.value.server"
			:action="store.confirm.value.action"
			:pending="store.pending.value"
			@cancel="store.confirm.value = null"
			@confirm="store.review"
		/>
	</div>
</template>
