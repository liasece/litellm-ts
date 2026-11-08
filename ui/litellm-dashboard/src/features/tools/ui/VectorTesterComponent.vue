<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { vectorStoresApi } from "../api/VectorStoresApi";
import type { VectorResult } from "../support/VectorStoreModels";
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ error: [message: string]; notice: [message: string] }>();
const query = ref(""),
	loading = ref(false),
	history = ref<{ query: string; results: VectorResult[]; timestamp: number }[]>([]),
	expanded = ref<Record<string, boolean>>({});
async function search() {
	if (!query.value.trim()) {
		emit("error", "Please enter a search query");
		return;
	}
	if (loading.value) return;
	loading.value = true;
	try {
		const results = await vectorStoresApi.search(props.id, query.value);
		history.value.unshift({ query: query.value, results, timestamp: Date.now() });
		query.value = "";
	} catch {
		emit("error", "Failed to search vector store");
	} finally {
		loading.value = false;
	}
}
function keydown(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		void search();
	}
}
function clear() {
	history.value = [];
	expanded.value = {};
	emit("notice", "Search history cleared");
}
</script>
<template>
	<UiCard appearance="antd" class="tools-vector-tester"
		><div class="tools-vector-tester-body">
			<header>
				<h4><UiIcon name="DatabaseOutlined" />Test Vector Store</h4>
				<UiButton v-if="history.length" size="small" @click="clear">Clear History</UiButton>
			</header>
			<div class="tools-vector-results-area">
				<div v-if="!history.length" class="tools-vector-test-empty">
					<UiIcon name="DatabaseOutlined" :size="48" /><span>Test your vector store by entering a search query below</span>
				</div>
				<section v-for="(entry, hi) in history" :key="hi" class="tools-vector-history-entry">
					<div class="tools-vector-user-query">
						<article>
							<header>
								<strong>Query</strong><time>{{ new Date(entry.timestamp).toLocaleString() }}</time>
							</header>
							<div>{{ entry.query }}</div>
						</article>
					</div>
					<div class="tools-vector-response">
						<article>
							<header>
								<UiIcon name="DatabaseOutlined" /><strong>Vector Store Results</strong
								><span>{{ entry.results.length }} results</span>
							</header>
							<div v-if="entry.results.length" class="tools-vector-result-list">
								<div v-for="(result, ri) in entry.results" :key="ri" class="tools-vector-result">
									<button
										type="button"
										class="tools-vector-result-toggle"
										@click="expanded[hi + '-' + ri] = !expanded[hi + '-' + ri]"
									>
										<span
											><UiIcon :name="expanded[hi + '-' + ri] ? 'DownOutlined' : 'RightOutlined'" /><strong
												>Result {{ ri + 1 }}</strong
											><small v-if="!expanded[hi + '-' + ri] && result.content[0]"
												>- {{ result.content[0].text.substring(0, 100) }}...</small
											></span
										><b>Score: {{ result.score.toFixed(4) }}</b>
									</button>
									<div v-if="expanded[hi + '-' + ri]" class="tools-vector-result-content">
										<div v-for="(content, ci) in result.content" :key="ci">
											<small>Content ({{ content.type }})</small>
											<p>{{ content.text }}</p>
										</div>
										<section v-if="result.file_id || result.filename || result.attributes">
											<small>Metadata</small>
											<div v-if="result.file_id"><strong>File ID:</strong> {{ result.file_id }}</div>
											<div v-if="result.filename"><strong>Filename:</strong> {{ result.filename }}</div>
											<div v-if="result.attributes && Object.keys(result.attributes).length">
												<strong>Attributes:</strong>
												<pre>{{ JSON.stringify(result.attributes, null, 2) }}</pre>
											</div>
										</section>
									</div>
								</div>
							</div>
							<p v-else>No results found</p>
						</article>
					</div>
					<hr v-if="hi < history.length - 1" />
				</section>
				<p v-if="loading" class="tools-vector-test-loading"><UiIcon name="LoadingOutlined" :size="24" /></p>
			</div>
			<form class="tools-vector-query" @submit.prevent="search">
				<UiInput
					v-model="query"
					multiline
					:auto-size="{ minRows: 1, maxRows: 4 }"
					placeholder="Enter your search query... (Shift+Enter for new line)"
					:disabled="loading"
					style="resize: none"
					@keydown="keydown"
				/><UiButton type="submit" variant="primary" :loading="loading" :disabled="loading || !query.trim()"
					><UiIcon name="SendOutlined" />Search</UiButton
				>
			</form>
		</div></UiCard
	>
</template>
