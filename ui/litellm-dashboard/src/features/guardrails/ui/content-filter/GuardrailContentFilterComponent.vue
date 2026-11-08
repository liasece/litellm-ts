<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { notificationManager } from "../../../notifications/logic/NotificationManager";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { guardrailsApi } from "../../api/GuardrailsApi";
import type { GuardrailContentDraft, GuardrailUiSettings } from "../../support/GuardrailModels";
import GuardrailContentTablesComponent from "./GuardrailContentTablesComponent.vue";
import GuardrailContentItemDialogComponent from "./GuardrailContentItemDialogComponent.vue";
import GuardrailContentTopicsComponent from "./GuardrailContentTopicsComponent.vue";
import GuardrailCompetitorComponent from "./GuardrailCompetitorComponent.vue";
const value = defineModel<GuardrailContentDraft>({ required: true });
defineProps<{
	settings: NonNullable<GuardrailUiSettings["content_filter_settings"]>;
	showStep?: "patterns" | "keywords" | "categories" | "competitor_intent";
}>();
const emit = defineEmits<{ fileUploaded: [content: string] }>(),
	auth = useAuthenticationStore(),
	dialog = ref(false),
	dialogType = ref<"prebuilt" | "custom" | "keyword">("prebuilt"),
	input = ref<HTMLInputElement>(),
	uploading = ref(false);
function open(type: "prebuilt" | "custom" | "keyword") {
	dialogType.value = type;
	dialog.value = true;
}
async function upload(event: Event) {
	const element = event.target as HTMLInputElement,
		file = element.files?.[0];
	element.value = "";
	if (!file) return;
	uploading.value = true;
	try {
		const content = await file.text();
		if (auth.isAuthorized.value) {
			const result = await guardrailsApi.validateKeywords(content);
			if (result.valid) {
				emit("fileUploaded", content);
				notificationManager.success(result.message || "File uploaded successfully");
			} else notificationManager.error("Validation failed: " + (result.error || result.errors?.join(", ") || "Invalid file"));
		}
	} catch (error) {
		notificationManager.error("Failed to upload file: " + String(error));
	} finally {
		uploading.value = false;
	}
}
</script>
<template>
	<div class="guardrail-content-filter">
		<p v-if="!showStep" class="guardrail-secondary">
			Configure patterns, keywords, and content categories to detect and filter sensitive information in requests and responses.
		</p>
		<UiCard v-if="!showStep || showStep === 'patterns'" appearance="antd" size="small"
			><template #title
				><div class="guardrail-content-card-title">
					<strong>Pattern Detection</strong
					><small>Detect sensitive information using regex patterns (SSN, credit cards, API keys, etc.)</small>
				</div></template
			>
			<div class="guardrail-content-actions">
				<UiButton variant="primary" @click="open('prebuilt')"><UiIcon name="PlusOutlined" />Add prebuilt pattern</UiButton
				><UiButton @click="open('custom')"><UiIcon name="PlusOutlined" />Add custom regex</UiButton>
			</div>
			<GuardrailContentTablesComponent
				:patterns="value.patterns"
				@remove="value.patterns = value.patterns.filter((pattern) => pattern.id !== $event)"
				@action="
					(id, action) =>
						(value.patterns = value.patterns.map((pattern) => (pattern.id === id ? { ...pattern, action } : pattern)))
				" /></UiCard
		><UiCard v-if="!showStep || showStep === 'keywords'" appearance="antd" size="small"
			><template #title
				><div class="guardrail-content-card-title">
					<strong>Blocked Keywords</strong><small>Block or mask specific sensitive terms and phrases</small>
				</div></template
			>
			<div class="guardrail-content-actions">
				<UiButton variant="primary" @click="open('keyword')"><UiIcon name="PlusOutlined" />Add keyword</UiButton
				><input ref="input" type="file" accept=".yaml,.yml" hidden @change="upload" /><UiButton
					:loading="uploading"
					@click="input?.click()"
					><UiIcon name="UploadOutlined" />Upload YAML file</UiButton
				>
			</div>
			<GuardrailContentTablesComponent
				:keywords="value.keywords"
				@remove="value.keywords = value.keywords.filter((word) => word.id !== $event)"
				@action="
					(id, action) => (value.keywords = value.keywords.map((word) => (word.id === id ? { ...word, action } : word)))
				" /></UiCard
		><GuardrailCompetitorComponent
			v-if="!showStep || showStep === 'competitor_intent' || showStep === 'categories'"
			v-model:enabled="value.competitorEnabled"
			v-model:config="value.competitorConfig"
		/><GuardrailContentTopicsComponent
			v-if="(!showStep || showStep === 'categories') && settings.content_categories?.length"
			v-model="value.categories"
			v-model:pending="value.pendingCategory"
			:available="settings.content_categories"
		/><GuardrailContentItemDialogComponent
			v-if="dialog"
			v-model:open="dialog"
			:type="dialogType"
			:patterns="settings.prebuilt_patterns || []"
			:categories="settings.pattern_categories || []"
			@pattern="value.patterns.push($event)"
			@keyword="value.keywords.push($event)"
		/>
	</div>
</template>
