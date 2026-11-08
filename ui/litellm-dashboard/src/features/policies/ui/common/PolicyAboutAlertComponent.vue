<script setup lang="ts">
import { ref } from "vue";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
defineProps<{ attachments?: boolean }>();
const visible = ref(true);
</script>
<template>
	<UiAlert
		v-if="visible"
		:title="attachments ? 'About Policy Attachments' : 'About Policies'"
		closable
		class="policy-about"
		@close="visible = false"
	>
		<template #icon><UiIcon name="InfoCircleOutlined" :size="24" /></template>
		<template v-if="attachments">
			<p class="policy-mb12">
				Policy attachments control where your policies apply. Policies don't do anything until you attach them to specific teams,
				keys, models, tags, or globally.
			</p>
			<p class="policy-mb8"><strong>Attachment Scopes:</strong></p>
			<ul>
				<li><strong>Global (*)</strong> - Applies to all requests</li>
				<li><strong>Teams</strong> - Applies only to specific teams</li>
				<li><strong>Keys</strong> - Applies only to specific API keys (supports wildcards like dev-*)</li>
				<li><strong>Models</strong> - Applies only when specific models are used</li>
				<li>
					<strong>Tags</strong> - Matches tags from key/team <code>metadata.tags</code> or tags passed dynamically in the request
					body (<code>metadata.tags</code>). Use this to enforce policies across groups, e.g. "all keys tagged
					<code>healthcare</code> get HIPAA guardrails." Supports wildcards (<code>prod-*</code>).
				</li>
			</ul>
			<a href="https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies#attachments" target="_blank" rel="noopener noreferrer"
				>Learn more about attachments →</a
			>
		</template>
		<template v-else
			><p class="policy-mb12">Use policies to group guardrails and control which ones run for specific teams, keys, or models.</p>
			<p class="policy-mb8"><strong>Why use policies?</strong></p>
			<ul>
				<li>Enable/disable specific guardrails for teams, keys, or models</li>
				<li>Group guardrails into a single policy</li>
				<li>Inherit from existing policies and override what you need</li>
			</ul>
			<a href="https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies" target="_blank" rel="noopener noreferrer"
				>Learn more in the documentation →</a
			></template
		>
	</UiAlert>
</template>
