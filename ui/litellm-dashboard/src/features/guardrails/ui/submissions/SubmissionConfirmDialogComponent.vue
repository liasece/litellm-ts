<script setup lang="ts">
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
defineProps<{ name: string; action: "approve" | "reject" }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>
<template>
	<UiDialog
		:open="true"
		:width="384"
		:closable="false"
		:mask-closable="false"
		:show-footer="false"
		centered
		class="guardrail-review-dialog"
		><div :class="['guardrail-review-confirm', action]">
			<span><UiLucideIcon :name="action === 'approve' ? 'CheckIcon' : 'AlertCircleIcon'" :size="20" /></span>
			<h3>{{ action === "approve" ? "Approve" : "Reject" }} Guardrail</h3>
			<p>
				Are you sure you want to {{ action }} <strong>"{{ name }}"</strong>?
				{{
					action === "approve"
						? "This will make it active and available for use."
						: "This will mark it as rejected and notify the team."
				}}
			</p>
			<footer>
				<button type="button" class="submission-neutral" @click="emit('cancel')">Cancel</button
				><button
					type="button"
					:class="action === 'approve' ? 'submission-approve' : 'submission-reject-confirm'"
					@click="emit('confirm')"
				>
					{{ action === "approve" ? "Approve" : "Reject" }}
				</button>
			</footer>
		</div></UiDialog
	>
</template>
