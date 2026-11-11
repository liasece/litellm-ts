<script setup lang="ts">
import { ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import { modelOptions, type ModelCatalog } from "../support/ModelModels";
import type { SemanticRoute } from "../logic/AutoRouterLogic";
const emptyDescription = 'No routes configured. Click "Add Route" to get started.';
const routes = defineModel<SemanticRoute[]>({ required: true });
defineProps<{ models: string[]; catalog: ModelCatalog }>();
const preview = ref(false),
	expanded = ref<string[]>([]);
function add() {
	const id = nextUiIdentity("route");
	routes.value = [...routes.value, { id, name: "", description: "", utterances: [], score_threshold: 0.5 }];
	expanded.value.push(id);
}
function remove(id: string) {
	routes.value = routes.value.filter((route) => route.id !== id);
	expanded.value = expanded.value.filter((value) => value !== id);
}
function config() {
	return {
		routes: routes.value.map(({ name, utterances, description, score_threshold }) => ({
			name,
			utterances,
			description,
			score_threshold,
		})),
	};
}
</script>
<template>
	<div class="model-semantic-routes">
		<header class="model-inline model-between">
			<h4>
				Routes Configuration
				<UiTooltip title="Configure routing logic to automatically select the best model based on user input patterns"
					><UiIcon name="InfoCircleOutlined"
				/></UiTooltip>
			</h4>
			<UiButton variant="primary" @click="add"
				><template #icon><UiIcon name="PlusOutlined" /></template>Add Route</UiButton
			>
		</header>
		<UiCard v-if="!routes.length" appearance="antd"><UiEmptyState :description="emptyDescription" /></UiCard>
		<div v-for="(route, index) in routes" :key="route.id" class="model-semantic-route">
			<button
				class="model-semantic-route__header"
				@click="expanded = expanded.includes(route.id) ? expanded.filter((value) => value !== route.id) : [...expanded, route.id]"
			>
				<UiIcon name="RightOutlined" :class="{ 'model-rotated': expanded.includes(route.id) }" /><span
					class="model-semantic-route__title"
					><ModelName :model="route.name" :size="14">Route {{ index + 1 }}: {{ route.name || "Unnamed" }}</ModelName></span
				><span
					class="model-semantic-delete"
					role="button"
					tabindex="0"
					:aria-label="'Delete route ' + (index + 1)"
					@click.stop="remove(route.id)"
					@keydown.enter.stop="remove(route.id)"
					><UiIcon name="DeleteOutlined"
				/></span>
			</button>
			<div v-if="expanded.includes(route.id)" class="model-semantic-route__body">
				<UiCard appearance="antd"
					><label
						>Model<UiSelect v-model="route.name" :options="modelOptions(models)" searchable placeholder="Select model" /></label
					><label
						>Description<UiInput
							v-model="route.description"
							multiline
							:rows="2"
							placeholder="Describe when this route should be used..." /></label
					><label
						>Score Threshold
						<UiTooltip title="Minimum similarity score to route to this model (0-1)"
							><UiIcon name="InfoCircleOutlined" /></UiTooltip
						><UiInputNumber v-model="route.score_threshold" :min="0" :max="1" :step="0.1" placeholder="0.5" /></label
					><label
						>Example Utterances
						<UiTooltip title="Training examples for this route. Type an utterance and press Enter to add it."
							><UiIcon name="InfoCircleOutlined"
						/></UiTooltip>
						<p class="model-small model-muted">
							Type an utterance and press Enter to add it. You can also paste multiple lines.
						</p>
						<UiSelect
							v-model="route.utterances"
							max-tag-count="responsive"
							:options="[]"
							multiple
							creatable
							searchable
							:token-separators="['\n']"
							clearable
							placeholder="Type an utterance and press Enter..." /></label
				></UiCard>
			</div>
		</div>
		<hr class="model-ant-divider" />
		<div class="model-inline model-between model-json-preview-heading">
			<strong>JSON Preview</strong><UiButton variant="link" @click="preview = !preview">{{ preview ? "Hide" : "Show" }}</UiButton>
		</div>
		<UiCard v-if="preview" appearance="antd" class="model-muted-card">
			<pre class="model-json-preview">{{ JSON.stringify(config(), null, 2) }}</pre>
		</UiCard>
	</div>
</template>
