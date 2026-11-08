<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import { searchToolsApi } from "../api/SearchToolsApi";
import type { SearchResult } from "../support/SearchToolModels";
const props = defineProps<{ name: string }>();
const emit = defineEmits<{ error: [message: string]; notice: [message: string] }>();
const query = ref(""),
	loading = ref(false),
	focused = ref(false),
	history = ref<{ query: string; results: SearchResult[]; timestamp: number; latency: number }[]>([]),
	expanded = ref<Record<string, boolean>>({}),
	latest = computed(() => history.value[0]);
async function search() {
	if (!query.value.trim()) {
		emit("error", "Please enter a search query");
		return;
	}
	if (loading.value) return;
	loading.value = true;
	const start = performance.now();
	try {
		const results = await searchToolsApi.query(props.name, query.value);
		history.value.unshift({ query: query.value, results, timestamp: Date.now(), latency: Math.round(performance.now() - start) });
	} catch {
		emit("error", "Failed to query search tool");
	} finally {
		loading.value = false;
	}
}
function clear() {
	history.value = [];
	expanded.value = {};
	emit("notice", "Search history cleared");
}
</script>
<template>
	<UiCard class="tools-search-tester"
		><h3>Test Search Tool</h3>
		<div class="tools-search-tester-body">
			<form class="tools-search-query" @submit.prevent="search">
				<div :class="{ 'tools-search-query-focused': focused }">
					<UiIcon name="SearchOutlined" :size="18" /><input
						v-model="query"
						placeholder="Enter your search query..."
						:disabled="loading"
						@focus="focused = true"
						@blur="focused = false"
					/>
				</div>
				<UiButton variant="primary" :disabled="loading || !query.trim()" :loading="loading" @click="search"
					><UiIcon name="SearchOutlined" />Search</UiButton
				>
			</form>
			<div class="tools-search-result-area">
				<div v-if="!latest && !loading" class="tools-search-initial">
					<div><UiIcon name="SearchOutlined" :size="48" /></div>
					<strong>Test your search tool</strong><span>Enter a query above to see search results</span>
				</div>
				<p v-if="loading" class="tools-search-searching">Searching...</p>
				<template v-if="latest && !loading"
					><header class="tools-search-query-summary">
						<div>
							<small>SEARCH QUERY</small><strong>{{ latest.query }}</strong>
						</div>
						<div>
							<small>{{ new Date(latest.timestamp).toLocaleString() }}</small>
							<p>
								<b>{{ latest.results.length }} {{ latest.results.length === 1 ? "result" : "results" }}</b
								><span>•</span><b>{{ latest.latency }}ms</b>
							</p>
						</div>
					</header>
					<div v-if="latest.results.length" class="tools-search-results">
						<article v-for="(result, index) in latest.results" :key="index">
							<header>
								<a :href="result.url" target="_blank" rel="noopener noreferrer">{{ result.title }}</a
								><a :href="result.url" target="_blank" rel="noopener noreferrer" aria-label="Open search result"
									><AccessHeroIconComponent name="ExternalLink"
								/></a>
							</header>
							<div class="tools-search-result-url">{{ result.url }}</div>
							<p>
								{{
									expanded["0-" + index]
										? result.snippet
										: result.snippet.substring(0, 200) + (result.snippet.length > 200 ? "..." : "")
								}}
							</p>
							<UiButton
								v-if="result.snippet.length > 200"
								variant="link"
								size="small"
								@click="expanded['0-' + index] = !expanded['0-' + index]"
								>{{ expanded["0-" + index] ? "Show less" : "Show more" }}</UiButton
							>
						</article>
					</div>
					<div v-else class="tools-search-no-results">
						<div><UiIcon name="SearchOutlined" :size="24" /></div>
						<strong>No results found</strong><span>Try a different search query</span>
					</div></template
				>
				<section v-if="history.length > 1" class="tools-search-history">
					<header>
						<strong>Previous Searches</strong><UiButton variant="link" size="small" @click="clear">Clear All</UiButton>
					</header>
					<button v-for="(entry, index) in history.slice(1, 6)" :key="index" type="button" @click="query = entry.query">
						<strong>{{ entry.query }}</strong
						><span
							><b>{{ entry.results.length }} {{ entry.results.length === 1 ? "result" : "results" }}</b> •
							<b>{{ entry.latency }}ms</b> • {{ new Date(entry.timestamp).toLocaleString() }}</span
						>
					</button>
				</section>
			</div>
		</div></UiCard
	>
</template>
