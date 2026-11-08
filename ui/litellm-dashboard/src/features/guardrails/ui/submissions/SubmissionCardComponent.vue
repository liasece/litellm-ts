<script setup lang="ts">
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import type { SubmittedGuardrail } from "../../support/GuardrailSubmissionModels";
import SubmissionBadgesComponent from "./SubmissionBadgesComponent.vue";
import SubmissionToggleComponent from "./SubmissionToggleComponent.vue";
defineProps<{ row: SubmittedGuardrail; selected: boolean; expanded: boolean }>();
const emit = defineEmits<{ select: []; forward: []; toggleHeaders: []; review: [action: "approve" | "reject"] }>();
</script>
<template>
	<div :class="['guardrail-submission-card', { selected }]">
		<div>
			<section>
				<SubmissionBadgesComponent :row="row" />
				<h3>{{ row.name }}</h3>
				<p>{{ row.description }}</p>
				<div class="guardrail-submission-endpoint">
					<UiLucideIcon name="ServerIcon" :size="14" /><code>{{ row.endpoint }}</code>
				</div>
				<div class="guardrail-submission-meta">
					<span
						>Model: <strong>{{ row.model }}</strong></span
					><span
						>Submitted: <strong>{{ row.submittedAt }}</strong></span
					>
				</div>
			</section>
			<aside>
				<label>Forward API Key<SubmissionToggleComponent :enabled="row.forwardKey" @toggle="emit('forward')" /></label>
				<div>
					<button type="button" class="submission-neutral" @click="emit('select')">{{ selected ? "Close" : "Review" }}</button
					><template v-if="row.status === 'pending'"
						><button type="button" class="submission-approve" @click="emit('review', 'approve')">Approve</button
						><button type="button" class="submission-reject" @click="emit('review', 'reject')">Reject</button></template
					>
				</div>
			</aside>
		</div>
		<footer>
			<button type="button" @click="emit('toggleHeaders')">
				<UiLucideIcon :name="expanded ? 'ChevronUpIcon' : 'ChevronDownIcon'" :size="14" />Static headers<span
					v-if="row.customHeaders.length"
					>{{ row.customHeaders.length }}</span
				>
			</button>
			<div v-if="expanded" class="submission-static-preview">
				<p v-if="!row.customHeaders.length">No static headers configured.</p>
				<div v-for="(header, index) in row.customHeaders" :key="index">
					<code>{{ header.key }}</code
					><span>:</span><code>{{ header.value }}</code>
				</div>
			</div>
		</footer>
	</div>
</template>
