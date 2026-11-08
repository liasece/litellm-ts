<script setup lang="ts">
import { computed } from "vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import GuardrailToolPermissionsComponent from "../editor/GuardrailToolPermissionsComponent.vue";
import { getGuardrailLogoAndName } from "../../logic/GuardrailProviderLogic";
import { legacyGuardrailText } from "../../support/GuardrailClipboardSupport";
import type { GuardrailRecord, ToolPermissionConfig } from "../../support/GuardrailModels";
const props = defineProps<{ record: GuardrailRecord; permissions: ToolPermissionConfig }>(),
	model = computed({ get: () => props.permissions, set: () => undefined }),
	provider = computed(() => getGuardrailLogoAndName(props.record.litellm_params.guardrail)),
	pii = computed(() => Object.keys(props.record.litellm_params.pii_entities_config ?? {})),
	date = (value?: string) => (value ? new Date(value).toLocaleString() : "-");
</script>
<template>
	<div class="guardrail-settings-summary">
		<section>
			<p>Guardrail ID</p>
			<code>{{ record.guardrail_id }}</code>
		</section>
		<section>
			<p>Guardrail Name</p>
			<div>{{ record.guardrail_name || "Unnamed Guardrail" }}</div>
		</section>
		<section>
			<p>Provider</p>
			<div>{{ provider.displayName }}</div>
		</section>
		<section>
			<p>Mode</p>
			<div>{{ legacyGuardrailText(record.litellm_params.mode) || "-" }}</div>
		</section>
		<section>
			<p>Default On</p>
			<UiTag appearance="tremor" :color="record.litellm_params.default_on ? 'green' : 'gray'">{{
				record.litellm_params.default_on ? "Yes" : "No"
			}}</UiTag>
		</section>
		<section v-if="pii.length">
			<p>PII Protection</p>
			<div>
				<UiTag appearance="tremor" color="blue">{{ pii.length }} PII entities configured</UiTag>
			</div>
		</section>
		<section>
			<p>Created At</p>
			<div>{{ date(record.created_at) }}</div>
		</section>
		<section>
			<p>Last Updated</p>
			<div>{{ date(record.updated_at) }}</div>
		</section>
		<GuardrailToolPermissionsComponent v-if="record.litellm_params.guardrail === 'tool_permission'" v-model="model" disabled />
	</div>
</template>
