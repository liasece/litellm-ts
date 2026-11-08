<script setup lang="ts">
import UiButton from "../../../platform/ui/UiButton.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
defineProps<{ confirmation: boolean; progress: number }>();
defineEmits<{ open: []; dismiss: []; dontAsk: [] }>();
</script>
<template>
	<aside class="claude-code-prompt">
		<div v-if="confirmation" class="claude-code-prompt__confirmation">
			<span><UiLucideIcon name="Check" :size="20" /></span>
			<p>Got it, we will not ask again. Reactivate this at any time in the User Menu.</p>
		</div>
		<template v-else
			><div class="claude-code-prompt__progress"><div :style="{ width: progress + '%' }" /></div>
			<div class="claude-code-prompt__body">
				<header>
					<div><UiLucideIcon name="Code" :size="20" /><strong>Claude Code Feedback</strong></div>
					<button type="button" aria-label="Dismiss Claude Code feedback" @click="$emit('dismiss')">
						<UiLucideIcon name="X" :size="16" />
					</button>
				</header>
				<p>Help us improve your Claude Code experience with LiteLLM! Share your feedback in 4 quick questions.</p>
				<div>
					<UiButton variant="primary" block class="claude-code-purple" @click="$emit('open')">Share feedback</UiButton
					><UiButton danger block class="claude-code-prompt__dont-ask" @click="$emit('dontAsk')">Don't ask me again</UiButton>
				</div>
			</div></template
		>
	</aside>
</template>
