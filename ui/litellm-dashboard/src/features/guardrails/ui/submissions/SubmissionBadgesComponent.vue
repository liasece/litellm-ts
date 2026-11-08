<script setup lang="ts">
import type { SubmittedGuardrail } from "../../support/GuardrailSubmissionModels";
import { submissionStatusLabel, submissionTeamClass } from "../../logic/GuardrailSubmissionLogic";
defineProps<{ row: SubmittedGuardrail }>();
</script>
<template>
	<div class="guardrail-submission-badges">
		<span :class="'team-' + submissionTeamClass(row.team)">Team: {{ row.team }}</span
		><span :class="'status-' + row.status"><i />{{ submissionStatusLabel[row.status] }}</span>
	</div>
</template>
