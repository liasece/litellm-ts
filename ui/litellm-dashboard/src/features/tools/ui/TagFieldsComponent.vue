<script setup lang="ts">
import UiButton from "../../platform/ui/UiButton.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import { budgetDurationOptions } from "../../access-control/support/TeamFields";
import type { TagModelOption } from "../support/TagModels";
const draft = defineModel<Record<string, unknown>>({ required: true });
defineProps<{ models: TagModelOption[]; creating?: boolean; error?: string; pending?: boolean }>();
defineEmits<{ cancel: []; submit: [] }>();
</script>
<template>
	<form class="tools-tag-form" @submit.prevent="$emit('submit')">
		<AccessFieldComponent
			v-model="draft[creating ? 'tag_name' : 'name']"
			name="tag-name"
			label="Tag Name"
			required
			:horizontal="creating"
			input-appearance="tremor"
			placeholder="Type..."
			:error="error"
		/><AccessFieldComponent
			v-model="draft.description"
			name="tag-description"
			label="Description"
			type="textarea"
			:horizontal="creating"
		/><AccessFieldComponent
			v-model="draft[creating ? 'allowed_llms' : 'models']"
			name="tag-models"
			label="Allowed Models"
			type="select"
			multiple
			:options="models"
			placeholder="Select Models"
			:horizontal="creating"
			tooltip="Select which models are allowed to process requests from this tag"
			tooltip-icon="InfoCircleOutlined"
		/>
		<details class="access-tremor-accordion tools-tag-budget">
			<summary>
				<span class="tools-tag-budget-heading"
					><h3>{{ creating ? "Budget & Rate Limits (Optional)" : "Budget & Rate Limits" }}</h3></span
				><AccessHeroIconComponent name="ChevronDown" :size="20" class="tools-tag-budget-chevron" />
			</summary>
			<div>
				<AccessFieldComponent
					v-model="draft.max_budget"
					name="tag-budget"
					label="Max Budget (USD)"
					type="number"
					:step="0.01"
					:horizontal="creating"
				/><AccessFieldComponent
					v-model="draft.budget_duration"
					name="tag-duration"
					label="Reset Budget"
					type="select"
					:options="budgetDurationOptions"
					placeholder="n/a"
					:horizontal="creating"
				/>
				<div class="tools-tag-tpm-note">
					TPM/RPM limits for tags are not currently supported. If you need this feature, please
					<a href="https://github.com/BerriAI/litellm/issues/new" target="_blank" rel="noopener noreferrer"
						>create a GitHub issue</a
					>.
				</div>
			</div>
		</details>
		<footer class="tools-form-footer">
			<UiButton v-if="!creating" appearance="tremor" variant="primary" @click="$emit('cancel')">Cancel</UiButton
			><UiButton type="submit" appearance="tremor" variant="primary" :loading="pending">{{
				creating ? "Create Tag" : "Save Changes"
			}}</UiButton>
		</footer>
	</form>
</template>
