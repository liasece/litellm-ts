<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import McpSemanticTestComponent from "./McpSemanticTestComponent.vue";
import { createMcpSemanticFilterStore } from "../stores/McpSemanticFilterStore";
import { vectorStoresApi } from "../api/VectorStoresApi";
import { objectValue } from "../logic/McpDraftLogic";
import type { EmbeddingModel } from "../support/VectorStoreModels";
import "../styles/McpSettingsStyles.css";
const emit = defineEmits<{ changed: [value: Record<string, unknown>] }>();
const store = createMcpSemanticFilterStore(),
	{ state, draft, schema } = store,
	models = ref<EmbeddingModel[]>([]),
	threshold = computed({
		get: () => Number(draft.similarity_threshold),
		set: (value) => {
			draft.similarity_threshold = value;
			state.dirty = true;
		},
	});
const enabledDescription = computed(() => String(objectValue(objectValue(schema.value.properties).enabled).description || ""));
async function save() {
	await store.save();
	if (!state.updateError) emit("changed", { ...draft });
}
onMounted(() => {
	void store.load();
	void vectorStoresApi
		.models()
		.then((value) => {
			models.value = value;
		})
		.catch(() => {});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<section class="tools-mcp-semantic">
		<AccessNoticeComponent :message="state.message" />
		<p v-if="state.loading">Loading...</p>
		<UiAlert v-else-if="state.error" title="Could not load MCP Semantic Filter settings" type="error">{{ state.error }}</UiAlert
		><template v-else
			><UiAlert title="Semantic Tool Filtering" type="info" show-icon
				>Filter MCP tools semantically based on query relevance. This reduces context window size and improves tool selection
				accuracy. Click 'Save Settings' to apply changes across all pods (takes effect within 10 seconds).</UiAlert
			><UiAlert v-if="state.saved" title="Settings saved successfully" type="success" show-icon closable /><UiAlert
				v-if="state.updateError"
				title="Could not update settings"
				type="error"
				>{{ state.updateError }}</UiAlert
			>
			<div class="tools-mcp-semantic-columns">
				<form @submit.prevent="save" @change="state.dirty = true">
					<UiCard appearance="antd"
						><AccessFieldComponent
							v-model="draft.enabled"
							label="Enable Semantic Filtering"
							type="switch"
							:disabled="state.pending"
							tooltip="When enabled, only the most relevant MCP tools will be included in requests based on semantic similarity"
							@change="state.dirty = true"
						/>
						<p class="tools-mcp-setting-description">{{ enabledDescription }}</p></UiCard
					><UiCard appearance="antd" title="Configuration"
						><AccessFieldComponent
							v-model="draft.embedding_model"
							label="Embedding Model"
							type="select"
							:options="
								models
									.filter((model) => model.mode === 'embedding')
									.map((model) => ({ value: model.model_group, label: model.model_group }))
							"
							placeholder="Select embedding model"
							tooltip="The model used to generate embeddings for semantic matching"
							:disabled="state.pending"
							@change="state.dirty = true"
						/><AccessFieldComponent
							v-model="draft.top_k"
							label="Top K Results"
							type="number"
							:min="1"
							tooltip="Maximum number of tools to return after filtering"
							:disabled="state.pending"
							@change="state.dirty = true"
						/><label class="tools-mcp-range-label"
							>Similarity Threshold<UiTooltip title="Minimum similarity score (0-1) for a tool to be included"
								><UiIcon name="QuestionCircleOutlined" /></UiTooltip
						></label>
						<div class="tools-mcp-range">
							<input
								v-model.number="threshold"
								type="range"
								:min="0"
								:max="1"
								:step="0.05"
								:disabled="state.pending"
								:style="{
									background: `linear-gradient(to right, #1677ff 0 ${Number(threshold) * 100}%, #f5f5f5 ${
										Number(threshold) * 100
									}% 100%)`,
								}"
							/>
							<div>
								<span
									v-for="mark in [0, 0.3, 0.5, 0.7, 1]"
									:key="mark"
									:class="{ active: mark <= Number(threshold) }"
									:style="{ left: mark * 100 + '%' }"
									>{{ mark.toFixed(1) }}</span
								>
							</div>
						</div></UiCard
					>
					<footer>
						<UiButton type="submit" variant="primary" :loading="state.pending" :disabled="!state.dirty"
							><UiIcon name="SaveOutlined" />Save Settings</UiButton
						>
					</footer>
				</form>
				<McpSemanticTestComponent
					:store="store"
					:models="models"
					@query="state.query = $event"
					@model="state.model = $event"
				/></div
		></template>
	</section>
</template>
