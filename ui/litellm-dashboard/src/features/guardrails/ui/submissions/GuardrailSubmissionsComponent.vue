<script setup lang="ts">
import { watch, onBeforeUnmount } from "vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createGuardrailSubmissionsStore } from "../../stores/GuardrailSubmissionsStore";
import SubmissionCardComponent from "./SubmissionCardComponent.vue";
import SubmissionDetailComponent from "./SubmissionDetailComponent.vue";
import SubmissionConfirmDialogComponent from "./SubmissionConfirmDialogComponent.vue";
import "../../styles/GuardrailSubmissionsStyles.css";
const auth = useAuthenticationStore(),
	store = createGuardrailSubmissionsStore(() => auth.isAuthorized.value),
	{ rows, summary, state, selected, expanded, confirmation } = store;
watch(auth.isAuthorized, () => void store.load(), { immediate: true });
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="guardrail-submissions">
		<div :class="['guardrail-submission-list', { selected: Boolean(selected) }]">
			<div class="submission-stats">
				<section
					v-for="card in [
						{ key: 'total', label: 'Total Submitted' },
						{ key: 'pending_review', label: 'Pending Review' },
						{ key: 'active', label: 'Active' },
						{ key: 'rejected', label: 'Rejected' },
					] as const"
					:key="card.key"
					:class="card.key"
				>
					<strong>{{ summary[card.key] }}</strong
					><span>{{ card.label }}</span>
				</section>
			</div>
			<div class="submission-filter-row">
				<label
					><UiLucideIcon name="SearchIcon" :size="16" /><input v-model="state.search" placeholder="Search guardrails..." /></label
				><select v-model="state.status" aria-label="Submission status">
					<option value="all">All Status</option>
					<option value="pending">Pending Review</option>
					<option value="active">Active</option>
					<option value="rejected">Rejected</option></select
				><button type="button"><UiLucideIcon name="PlusIcon" :size="16" />Add Guardrail</button>
			</div>
			<div class="submission-list-cards">
				<div v-if="state.loading" class="submission-loading">Loading submissions…</div>
				<div v-if="state.error" class="submission-error">{{ state.error }}</div>
				<div v-if="!state.loading && !state.error && !rows.length" class="submission-list-empty">
					No guardrails match your filters.
				</div>
				<template v-if="!state.loading && !state.error"
					><SubmissionCardComponent
						v-for="row in rows"
						:key="row.id"
						:row="row"
						:selected="row.id === state.selectedId"
						:expanded="expanded.has(row.id)"
						@select="state.selectedId = state.selectedId === row.id ? '' : row.id"
						@forward="store.forward(row.id)"
						@toggle-headers="store.toggleHeaders(row.id)"
						@review="confirmation = { id: row.id, action: $event }"
				/></template>
			</div>
		</div>
		<SubmissionDetailComponent
			v-if="selected"
			:row="selected"
			@close="state.selectedId = ''"
			@forward="store.forward(selected.id)"
			@headers="store.headers(selected.id, $event)"
			@extra="store.extra(selected.id, $event)"
			@review="confirmation = { id: selected.id, action: $event }"
		/><SubmissionConfirmDialogComponent
			v-if="confirmation"
			:name="rows.find((row) => row.id === confirmation?.id)?.name ?? ''"
			:action="confirmation.action"
			@cancel="confirmation = null"
			@confirm="store.review"
		/>
	</div>
</template>
