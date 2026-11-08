<script setup lang="ts">
import { computed, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import MarkdownContent from "../../content/ui/MarkdownContent.vue";
import type { CliProxyReleaseInfo } from "../support/CliProxyModels";
const props = defineProps<{ releases: CliProxyReleaseInfo[]; current: string | null; latest: string }>();
const showAll = ref(false);
const visibleReleases = computed(() => (showAll.value ? props.releases : props.releases.slice(0, 3)));
const hiddenCount = computed(() => Math.max(0, props.releases.length - 3));
const date = (value: string) => new Date(value).toLocaleDateString();
</script>
<template>
	<div class="cp-release-history">
		<div class="cp-between cp-wrap cp-gap-8 cp-mb-8">
			<div><strong>Version changes</strong><span class="cp-secondary cp-xs cp-ml-8">Latest release notes</span></div>
			<UiButton v-if="hiddenCount > 0" size="small" variant="link" class="cp-link-button" @click="showAll = !showAll">{{
				showAll ? "Show less" : "View more (" + hiddenCount + ")"
			}}</UiButton>
		</div>
		<div v-if="visibleReleases.length" class="cp-release-collapse">
			<details v-for="release in visibleReleases" :key="release.version">
				<summary>
					<UiIcon name="RightOutlined" :size="12" class="cp-collapse-caret" /><span class="cp-inline cp-wrap cp-gap-8"
						><strong>v{{ release.version }}</strong
						><UiTag v-if="release.version === current" color="blue">Current</UiTag
						><UiTag v-if="release.version === latest" color="green">Latest</UiTag
						><span v-if="release.published_at" class="cp-secondary cp-xs">{{ date(release.published_at) }}</span></span
					>
				</summary>
				<div class="cp-release-content">
					<MarkdownContent v-if="release.notes" :source="release.notes" link-target="_blank" /><span v-else class="cp-secondary"
						>No release notes provided.</span
					><a class="cp-block cp-mt-8" :href="release.release_url" target="_blank" rel="noreferrer">View release on GitHub</a>
				</div>
			</details>
		</div>
		<span v-else class="cp-secondary">No release notes available.</span>
	</div>
</template>
