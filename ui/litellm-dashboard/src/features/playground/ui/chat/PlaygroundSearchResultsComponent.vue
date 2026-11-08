<script setup lang="ts">
import { computed, ref } from "vue";
import { asRecord, records, number as numberValue } from "../../logic/PlaygroundValueLogic";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
const props = defineProps<{ results: Record<string, unknown>[] }>(),
	expanded = ref(true),
	opened = ref<Record<string, boolean>>({});
const total = computed(() => props.results.reduce((sum, page) => sum + records(page.data).length, 0));
</script>
<template>
	<div v-if="results.length" class="pg-search">
		<UiButton variant="text" size="small" @click="expanded = !expanded"
			><template #icon><UiIcon name="DatabaseOutlined" /></template>{{ expanded ? "Hide sources" : "Show sources (" + total + ")"
			}}<UiIcon :name="expanded ? 'DownOutlined' : 'RightOutlined'"
		/></UiButton>
		<div v-if="expanded" class="pg-search__panel">
			<div v-for="(page, pageIndex) in results" :key="pageIndex" class="pg-search__page">
				<div class="pg-search__query">
					<strong>Query:</strong><i>"{{ page.search_query }}"</i><span>•</span
					><span>{{ records(page.data).length }} result{{ records(page.data).length !== 1 ? "s" : "" }}</span>
				</div>
				<div v-for="(result, index) in records(page.data)" :key="index" class="pg-search__result">
					<button
						type="button"
						class="pg-search__heading"
						:aria-expanded="Boolean(opened[pageIndex + '-' + index])"
						@click="opened[pageIndex + '-' + index] = !opened[pageIndex + '-' + index]"
					>
						<UiIcon :name="opened[pageIndex + '-' + index] ? 'DownOutlined' : 'RightOutlined'" /><UiIcon
							name="FileTextOutlined"
						/><span>{{ result.filename || result.file_id || "Result " + (index + 1) }}</span
						><code>{{ (numberValue(result.score) ?? 0).toFixed(3) }}</code>
					</button>
					<div v-if="opened[pageIndex + '-' + index]" class="pg-search__content">
						<pre v-for="(content, contentIndex) in records(result.content)" :key="contentIndex">{{ content.text }}</pre>
						<div v-if="Object.keys(asRecord(result.attributes) || {}).length" class="pg-search__metadata">
							<strong>Metadata:</strong>
							<div v-for="(value, key) in asRecord(result.attributes)" :key="key">
								<span>{{ key }}:</span> <code>{{ String(value) }}</code>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
