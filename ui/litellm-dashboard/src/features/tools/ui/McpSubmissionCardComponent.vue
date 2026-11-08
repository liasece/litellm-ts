<script setup lang="ts">
import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { MCP_REQUIRED_FIELD_DEFS } from "../support/McpStandardsSupport";
import type { MCPServer } from "../support/McpModels";
const props = defineProps<{ server: MCPServer; required: string[] }>();
const emit = defineEmits<{ approve: []; reject: [] }>();
const status = computed(() => props.server.approval_status || "active"),
	checks = computed(() =>
		MCP_REQUIRED_FIELD_DEFS.filter((field) => props.required.includes(field.key)).map((field) => ({
			...field,
			passed: field.check(props.server),
		})),
	),
	passed = computed(() => checks.value.filter((field) => field.passed).length),
	failed = computed(() => checks.value.length - passed.value);
function date(value: string | null | undefined) {
	if (!value) return "—";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}
</script>
<template>
	<article class="tools-mcp-submission-card">
		<div class="tools-mcp-submission-info">
			<div class="tools-mcp-submission-main">
				<div class="tools-mcp-submission-badge">
					<span :class="['tools-mcp-review-status', 'tools-mcp-review-status--' + status]"
						><i />{{ status === "pending_review" ? "Pending Review" : status === "active" ? "Active" : "Rejected" }}</span
					>
				</div>
				<h3>{{ server.alias ?? server.server_name ?? server.server_id }}</h3>
				<p v-if="server.description" class="tools-mcp-submission-summary">{{ server.description }}</p>
				<div v-if="server.url" class="tools-mcp-submission-url">
					<UiLucideIcon name="ServerIcon" :size="14" /><code>{{ server.url }}</code>
				</div>
				<div class="tools-mcp-submission-meta">
					<span
						>Transport: <b>{{ server.transport || "sse" }}</b></span
					>
					<span>·</span>
					<span
						>Submitted by: <b>{{ server.submitted_by || "—" }}</b></span
					>
					<span>·</span>
					<span>{{ date(server.submitted_at) }}</span>
				</div>
				<p v-if="status === 'rejected' && server.review_notes" class="tools-mcp-rejection">
					Rejection reason: {{ server.review_notes }}
				</p>
			</div>
			<div v-if="!checks.length" class="tools-mcp-review-actions">
				<button v-if="status !== 'active' && status !== 'rejected'" type="button" class="approve" @click="emit('approve')">
					Approve</button
				><button v-if="status === 'rejected'" type="button" class="approve" @click="emit('approve')">Re-approve</button
				><button v-if="status !== 'rejected'" type="button" class="reject" @click="emit('reject')">Reject</button>
			</div>
		</div>
		<div v-if="checks.length" class="tools-mcp-compliance">
			<header :class="{ failed: failed > 0 }">
				<div class="tools-mcp-check-circle"><UiLucideIcon :name="failed ? 'X' : 'Check'" :size="16" /></div>
				<div>
					<strong>{{ failed ? failed + " check" + (failed !== 1 ? "s" : "") + " failed" : "All checks passed" }}</strong
					><small>{{ passed }} passing, {{ failed }} failing</small>
				</div>
				<div class="tools-mcp-review-actions">
					<button v-if="status !== 'active'" type="button" class="approve" @click="emit('approve')">
						{{ status === "rejected" ? "Re-approve" : "Approve" }}</button
					><button v-if="status !== 'rejected'" type="button" class="reject" @click="emit('reject')">Reject</button>
				</div>
			</header>
			<div v-for="check in checks" :key="check.key" class="tools-mcp-check-row" :class="{ failed: !check.passed }">
				<span><UiLucideIcon :name="check.passed ? 'Check' : 'X'" :size="12" /></span><label>{{ check.label }}</label
				><small>{{ check.passed ? "Passes" : "Missing" }}</small>
			</div>
		</div>
	</article>
</template>
