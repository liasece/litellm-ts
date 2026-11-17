<script setup lang="ts">
import { computed } from "vue";
import type { LogEntry } from "../../support/LogsModels";
import { privacyReplacementView } from "../../logic/LogDetailsPrivacyLogic";
import UiTag from "../../../platform/ui/UiTag.vue";
import PrivacyPlaceholderText from "../../../content/ui/PrivacyPlaceholderText.vue";
import LogDetailsCollapseComponent from "./LogDetailsCollapseComponent.vue";
const props = defineProps<{ log: LogEntry }>();
const view = computed(() => privacyReplacementView(props.log));
</script>
<template>
	<LogDetailsCollapseComponent v-if="view.visible" label="Privacy">
		<template #label>
			<div class="ld-privacy-heading">
				<h3>Privacy</h3>
				<UiTag color="orange">{{ view.occurrences }} replacement{{ view.occurrences === 1 ? "" : "s" }}</UiTag>
				<span v-if="view.summary" class="ld-privacy-summary">{{ view.summary }}</span>
			</div>
		</template>
		<div class="ld-privacy">
			<p class="ld-privacy__note">
				Only redacted placeholders are stored. Original values are never persisted, so this shows the exact tokens sent upstream and
				a short surrounding context. The heading counts replacements recorded by the gateway, matching the Privacy badge in the logs
				list; the ×N on each row counts how often that token appears in the stored content.
			</p>
			<div v-if="view.replacements.length === 0" class="ld-privacy__empty">
				<template v-if="view.featureDetail">Recorded replacements: {{ view.featureDetail }}. </template>
				No redaction placeholders were found in the loaded content. The content may be unavailable, or a credential may use a
				shape-preserving replacement.
			</div>
			<div v-for="item in view.replacements" :key="item.token" class="ld-privacy__item" data-testid="privacy-replacement">
				<div class="ld-privacy__meta">
					<UiTag color="orange">{{ item.kindLabel }}</UiTag>
					<code class="ld-privacy__token">{{ item.token }}</code>
					<span class="ld-secondary">{{ item.occurrences }}× · {{ item.locations.join(" / ") }}</span>
				</div>
				<div class="ld-privacy__context"><PrivacyPlaceholderText :text="item.context" /></div>
				<div v-if="item.field" class="ld-privacy__field">{{ item.field }}</div>
			</div>
		</div>
	</LogDetailsCollapseComponent>
</template>
