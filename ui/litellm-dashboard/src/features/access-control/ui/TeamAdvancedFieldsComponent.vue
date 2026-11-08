<script setup lang="ts">
import { computed } from "vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import KeyLoggingFieldsComponent from "../../virtual-keys/ui/KeyLoggingFieldsComponent.vue";
import type { KeyLoggingConfiguration } from "../../virtual-keys/support/VirtualKeyModels";
import { objectValue } from "../logic/ResourceDraftLogic";
import type { AccessRecord } from "../support/AccessModels";
const draft = defineModel<AccessRecord>({ required: true });
defineProps<{ editing?: boolean; premium?: boolean; showLogging?: boolean; errors?: Record<string, string> }>();
const logging = computed({
	get: () => ({
		logging: Array.isArray(draft.value.logging_settings)
			? (draft.value.logging_settings.map((value) => ({
					...objectValue(value),
					callback_name: String(objectValue(value).callback_name ?? ""),
				})) as KeyLoggingConfiguration[])
			: [],
		disabled_callbacks: [] as string[],
	}),
	set: (value) => {
		draft.value.logging_settings = value.logging;
	},
});
</script>
<template>
	<div>
		<AccessFieldComponent
			v-if="!editing"
			v-model="draft.team_id"
			name="team-custom-id"
			label="Team ID"
			horizontal
		/><AccessFieldComponent
			v-if="editing"
			v-model="draft.organization_id"
			name="team-organization-id"
			label="Organization ID"
			disabled
		/>
		<section v-if="showLogging" class="access-team-logging">
			<label>Logging Settings</label><KeyLoggingFieldsComponent v-model="logging" />
		</section>
		<AccessFieldComponent
			v-model="draft.secret_manager_settings"
			name="team-secret-manager"
			label="Secret Manager Settings"
			type="textarea"
			:rows="6"
			:placeholder="'{&quot;namespace&quot;: &quot;admin&quot;, &quot;mount&quot;: &quot;secret&quot;, &quot;path_prefix&quot;: &quot;litellm&quot;}'"
			:disabled="!premium"
			:help="
				premium
					? 'Enter secret manager configuration as a JSON object.'
					: 'Premium feature - Upgrade to manage secret manager settings.'
			"
			:horizontal="!editing"
			:error="errors?.secret_manager_settings"
		/><AccessFieldComponent
			v-model="draft.metadata"
			name="team-metadata"
			label="Metadata"
			type="textarea"
			:rows="10"
			:horizontal="!editing"
			:error="errors?.metadata"
		/>
	</div>
</template>
