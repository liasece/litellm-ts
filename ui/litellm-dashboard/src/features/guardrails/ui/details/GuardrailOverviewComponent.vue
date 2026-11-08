<script setup lang="ts">
import { computed, ref } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import GuardrailToolPermissionsComponent from "../editor/GuardrailToolPermissionsComponent.vue";
import GuardrailContentDisplayComponent from "../content-filter/GuardrailContentDisplayComponent.vue";
import { getGuardrailLogoAndName } from "../../logic/GuardrailProviderLogic";
import { legacyGuardrailText } from "../../support/GuardrailClipboardSupport";
import type { GuardrailRecord, GuardrailContentDraft, ToolPermissionConfig } from "../../support/GuardrailModels";
const props = defineProps<{
		record: GuardrailRecord;
		content: GuardrailContentDraft;
		permissions: ToolPermissionConfig;
		isAdmin: boolean;
	}>(),
	emit = defineEmits<{ editCode: [] }>(),
	provider = computed(() => getGuardrailLogoAndName(props.record.litellm_params.guardrail)),
	logoVisible = ref(true),
	permissionsModel = computed({ get: () => props.permissions, set: () => undefined }),
	pii = computed(() => Object.entries(props.record.litellm_params.pii_entities_config ?? {})),
	date = (value?: string) => (value ? new Date(value).toLocaleString() : "-");
</script>
<template>
	<div class="guardrail-overview">
		<div class="guardrail-overview-grid">
			<UiCard
				><p>Provider</p>
				<div class="guardrail-overview-provider">
					<img
						v-if="provider.logo && logoVisible"
						:src="provider.logo"
						:alt="provider.displayName + ' logo'"
						@error="logoVisible = false"
					/>
					<h3>{{ provider.displayName }}</h3>
				</div></UiCard
			><UiCard
				><p>Mode</p>
				<div>
					<h3>{{ legacyGuardrailText(record.litellm_params.mode) || "-" }}</h3>
					<UiTag appearance="tremor" :color="record.litellm_params.default_on ? 'green' : 'gray'"
						>Default {{ record.litellm_params.default_on ? "On" : "Off" }}</UiTag
					>
				</div></UiCard
			><UiCard
				><p>Created At</p>
				<div>
					<h3>{{ date(record.created_at) }}</h3>
					<p>Last Updated: {{ date(record.updated_at) }}</p>
				</div></UiCard
			>
		</div>
		<UiCard v-if="pii.length" class="guardrail-pii-summary"
			><div>
				<p>PII Protection</p>
				<UiTag appearance="tremor" color="blue">{{ pii.length }} PII entities configured</UiTag>
			</div></UiCard
		><UiCard v-if="pii.length" class="guardrail-pii-config"
			><h3>PII Entity Configuration</h3>
			<div>
				<header><span>Entity Type</span><span>Configuration</span></header>
				<div>
					<section v-for="[entity, action] in pii" :key="entity">
						<strong>{{ entity }}</strong
						><span
							><span
								class="guardrail-pii-action"
								:class="action === 'MASK' ? 'guardrail-action-mask' : 'guardrail-action-block'"
								><UiIcon :name="action === 'MASK' ? 'EyeInvisibleOutlined' : 'StopOutlined'" />{{ String(action) }}</span
							></span
						>
					</section>
				</div>
			</div></UiCard
		><UiCard v-if="record.litellm_params.guardrail === 'tool_permission'" class="guardrail-detail-section"
			><GuardrailToolPermissionsComponent v-model="permissionsModel" disabled /></UiCard
		><UiCard
			v-if="record.litellm_params.guardrail === 'custom_code' && record.litellm_params.custom_code"
			class="guardrail-detail-section"
			><header>
				<h3><UiIcon name="CodeOutlined" />Custom Code</h3>
				<UiButton v-if="isAdmin && record.guardrail_definition_location !== 'config'" size="small" @click="emit('editCode')"
					><UiIcon name="CodeOutlined" />Edit Code</UiButton
				>
			</header>
			<pre class="guardrail-custom-preview"><code>{{ record.litellm_params.custom_code }}</code></pre></UiCard
		><GuardrailContentDisplayComponent v-if="record.litellm_params.guardrail === 'litellm_content_filter'" :content="content" />
	</div>
</template>
