<script setup lang="ts">
import { ref, computed } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import type { EmbeddingModel } from "../support/VectorStoreModels";
import { getCurlCommand } from "../logic/McpSemanticLogic";
import type { createMcpSemanticFilterStore } from "../stores/McpSemanticFilterStore";
const props = defineProps<{ store: ReturnType<typeof createMcpSemanticFilterStore>; models: EmbeddingModel[] }>();
const emit = defineEmits<{ query: [value: string]; model: [value: string] }>();
const query = computed({ get: () => props.store.state.query, set: (value) => emit("query", value) }),
	model = computed({ get: () => props.store.state.model, set: (value) => emit("model", String(value ?? "")) });
const tab = ref("test"),
	curl = computed(() => getCurlCommand(props.store.state.model, props.store.state.query));
</script>
<template>
	<UiCard appearance="antd" title="Test Configuration" class="tools-mcp-semantic-test"
		><UiTabs
			v-model="tab"
			:items="[
				{ key: 'test', label: 'Test' },
				{ key: 'api', label: 'API Usage' },
			]"
		/>
		<div v-if="tab === 'test'" class="tools-mcp-semantic-test-fields">
			<div>
				<strong><UiIcon name="PlayCircleOutlined" /> Test Query</strong
				><UiInput
					v-model="query"
					multiline
					:rows="4"
					placeholder="Enter a test query to see which tools would be selected..."
					:disabled="store.state.testing"
				/>
			</div>
			<div>
				<strong><UiIcon name="RobotOutlined" /> Select Model</strong
				><UiSelect
					v-model="model"
					:options="models.map((model) => ({ value: model.model_group, label: model.model_group }))"
					:disabled="store.state.testing"
					searchable
				/>
			</div>
			<UiButton
				variant="primary"
				:loading="store.state.testing"
				:disabled="!store.state.query || !store.state.model || !store.applied.value.enabled"
				@click="store.test"
				><UiIcon name="PlayCircleOutlined" />Test Filter</UiButton
			><UiAlert v-if="!store.applied.value.enabled" title="Semantic filtering is disabled" type="warning" show-icon
				>Enable semantic filtering and save settings to test the filter.</UiAlert
			>
			<section v-if="store.result.value">
				<h5>Results</h5>
				<UiAlert :title="store.result.value.selectedTools + ' tools selected'" type="success" show-icon
					>Filtered from {{ store.result.value.totalTools }} available tools</UiAlert
				><strong>Selected Tools:</strong>
				<ul>
					<li v-for="(tool, index) in store.result.value.tools" :key="index">{{ tool }}</li>
				</ul>
			</section>
		</div>
		<div v-else class="tools-mcp-semantic-api">
			<strong><UiIcon name="CodeOutlined" /> API Usage</strong>
			<p>Use this curl command to test the semantic filter with your current configuration.</p>
			<strong>Response headers to check:</strong>
			<ul>
				<li>x-litellm-semantic-filter: shows total tools → selected tools<small>Example: 10→3</small></li>
				<li>
					x-litellm-semantic-filter-tools: CSV of selected tool names<small
						>Example: wikipedia-fetch,github-search,slack-post</small
					>
				</li>
			</ul>
			<pre>{{ curl }}</pre>
		</div></UiCard
	>
</template>
