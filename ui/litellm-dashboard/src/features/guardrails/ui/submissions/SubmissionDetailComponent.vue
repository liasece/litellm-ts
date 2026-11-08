<script setup lang="ts">
import { ref } from "vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import type { SubmittedGuardrail } from "../../support/GuardrailSubmissionModels";
import SubmissionBadgesComponent from "./SubmissionBadgesComponent.vue";
import SubmissionToggleComponent from "./SubmissionToggleComponent.vue";
import SubmissionHeaderFieldsComponent from "./SubmissionHeaderFieldsComponent.vue";
import { buildEquivalentConfigYaml } from "../../logic/GuardrailSubmissionYamlLogic";
defineProps<{ row: SubmittedGuardrail }>();
const emit = defineEmits<{
		close: [];
		forward: [];
		headers: [value: { key: string; value: string }[]];
		extra: [value: string[]];
		review: [action: "approve" | "reject"];
	}>(),
	expanded = ref(false);
</script>
<template>
	<aside class="guardrail-submission-detail">
		<div>
			<header>
				<div>
					<SubmissionBadgesComponent :row="row" />
					<h2>{{ row.name }}</h2>
					<p>Submitted by {{ row.submittedBy }} on {{ row.submittedAt }}</p>
				</div>
				<button type="button" aria-label="Close detail panel" @click="emit('close')">
					<UiLucideIcon name="XIcon" :size="16" />
				</button>
			</header>
			<p class="submission-detail-description">{{ row.description }}</p>
			<div class="submission-config-fields">
				<section>
					<label>Endpoint</label>
					<div class="submission-detail-endpoint">
						<code>{{ row.endpoint }}</code
						><a :href="row.endpoint" target="_blank" rel="noopener noreferrer"
							><UiLucideIcon name="ExternalLinkIcon" :size="14"
						/></a>
					</div>
				</section>
				<section>
					<label>Method</label><span class="submission-method">{{ row.method }}</span>
				</section>
				<section class="submission-forward-box">
					<header>
						<span><UiLucideIcon name="KeyIcon" :size="14" />Forward LiteLLM API Key</span
						><SubmissionToggleComponent :enabled="row.forwardKey" @toggle="emit('forward')" />
					</header>
					<p>
						When enabled, the caller's LiteLLM API key is forwarded as an <code>Authorization</code> header to your guardrail
						endpoint. This allows your guardrail to authenticate model calls using the original caller's credentials.
					</p>
				</section>
				<SubmissionHeaderFieldsComponent :row="row" @headers="emit('headers', $event)" @extra="emit('extra', $event)" />
				<section class="submission-equivalent">
					<button type="button" @click="expanded = !expanded">
						Equivalent config<UiLucideIcon :name="expanded ? 'ChevronUpIcon' : 'ChevronDownIcon'" :size="14" />
					</button>
					<pre v-if="expanded">{{ buildEquivalentConfigYaml(row) }}</pre>
				</section>
				<section class="submission-info">
					<UiLucideIcon name="InfoIcon" :size="14" />
					<p>
						This guardrail runs on a separate instance. It receives the user request and forwards the result to the next step in
						the pipeline. See
						<a
							href="https://docs.litellm.ai/docs/adding_provider/generic_guardrail_api"
							target="_blank"
							rel="noopener noreferrer"
							>LiteLLM Generic Guardrail API docs</a
						>
						for configuration details.
					</p>
				</section>
			</div>
			<footer>
				<button type="button" class="submission-neutral"><UiLucideIcon name="ExternalLinkIcon" :size="16" />Test Endpoint</button>
				<div v-if="row.status === 'pending'">
					<button type="button" class="submission-approve" @click="emit('review', 'approve')">
						<UiLucideIcon name="CheckIcon" :size="16" />Approve</button
					><button type="button" class="submission-reject" @click="emit('review', 'reject')">
						<UiLucideIcon name="XIcon" :size="16" />Reject
					</button>
				</div>
			</footer>
		</div>
	</aside>
</template>
