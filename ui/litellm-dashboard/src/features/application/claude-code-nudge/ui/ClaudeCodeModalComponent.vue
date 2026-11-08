<script setup lang="ts">
import UiButton from "../../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import { claudeCodeFeedbackUrl } from "../api/ClaudeCodeNudgeApi";
defineEmits<{ close: []; complete: [] }>();
function openForm() {
	window.open(claudeCodeFeedbackUrl, "_blank", "noopener,noreferrer");
}
</script>
<template>
	<div class="claude-code-modal" role="dialog" aria-modal="true" aria-label="Claude Code Feedback">
		<div class="claude-code-modal__mask" @click="$emit('close')" />
		<section>
			<header>
				<div><UiLucideIcon name="Code" :size="20" /><strong>Claude Code Feedback</strong></div>
				<button type="button" aria-label="Close Claude Code feedback" @click="$emit('close')">
					<UiLucideIcon name="X" :size="20" />
				</button>
			</header>
			<div>
				<h2>Help us improve your experience</h2>
				<p>
					We'd love to hear about your experience using LiteLLM with Claude Code. Your feedback helps us improve the product for
					everyone.
				</p>
				<p>This brief survey takes about 2-3 minutes to complete.</p>
				<UiButton
					variant="primary"
					size="large"
					block
					class="claude-code-purple"
					@click="
						openForm();
						$emit('complete');
					"
					><template #icon><UiLucideIcon name="ExternalLink" :size="16" /></template>Open Feedback Form</UiButton
				>
			</div>
		</section>
	</div>
</template>
