<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CodeInterpreterResult } from "../../support/PlaygroundModels";
import { containerFile, downloadContainerFile } from "../../api/PlaygroundContainerFilesApi";
import CodeHighlightComponent from "../../../content/ui/CodeHighlightComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ result: CodeInterpreterResult }>(),
	urls = ref<Record<string, string>>({}),
	loading = ref<Record<string, boolean>>({});
function image(name: string) {
	return /\.(png|jpe?g|gif)$/i.test(name);
}
const images = computed(() => props.result.annotations.filter((item) => image(item.filename))),
	files = computed(() => props.result.annotations.filter((item) => !image(item.filename)));
let controller: AbortController | undefined;
function clear() {
	controller?.abort();
	Object.values(urls.value).forEach(URL.revokeObjectURL);
	urls.value = {};
	loading.value = {};
}
watch(
	() => props.result.annotations,
	async (annotations) => {
		clear();
		controller = new AbortController();
		const signal = controller.signal;
		for (const annotation of annotations) {
			if (!image(annotation.filename) || !annotation.container_id || !annotation.file_id) continue;
			loading.value = { ...loading.value, [annotation.file_id]: true };
			try {
				const blob = await containerFile(annotation, signal);
				if (signal.aborted) break;
				urls.value = { ...urls.value, [annotation.file_id]: URL.createObjectURL(blob) };
			} catch {
				/* A missing image keeps its visible fallback. */
			} finally {
				if (!signal.aborted) loading.value = { ...loading.value, [annotation.file_id]: false };
			}
		}
	},
	{ immediate: true },
);
onBeforeUnmount(clear);
</script>
<template>
	<div v-if="result.code || result.annotations.length" class="pg-code-output">
		<details v-if="result.code">
			<summary><UiIcon name="RightOutlined" /><UiIcon name="CodeOutlined" /> Python Code Executed</summary>
			<CodeHighlightComponent
				:code="result.code"
				language="python"
				:custom-style="{ margin: 0, borderRadius: '6px', fontSize: '12px', maxHeight: '300px', overflow: 'auto' }"
			/>
		</details>
		<div v-for="annotation in images" :key="annotation.file_id" class="pg-code-output__image">
			<div v-if="loading[annotation.file_id]" class="pg-code-output__loading"><UiSpinner /> Loading image...</div>
			<template v-else-if="urls[annotation.file_id]"
				><img :src="urls[annotation.file_id]" :alt="annotation.filename || 'Generated chart'" />
				<div class="pg-between">
					<span><UiIcon name="FileImageOutlined" /> {{ annotation.filename }}</span
					><button type="button" @click="downloadContainerFile(annotation)"><UiIcon name="DownloadOutlined" /> Download</button>
				</div></template
			>
			<div v-else class="pg-code-output__loading">Image not available</div>
		</div>
		<div v-if="files.length" class="pg-code-output__files">
			<button v-for="annotation in files" :key="annotation.file_id" type="button" @click="downloadContainerFile(annotation)">
				<UiIcon name="FileTextOutlined" />{{ annotation.filename }}<UiIcon name="DownloadOutlined" />
			</button>
		</div>
	</div>
</template>
