<script setup lang="ts">
import { computed, ref } from "vue";
import type { PolicyTemplate } from "../../support/PolicyModels";
import { templateTagCounts, templateHasTags } from "../../logic/PolicyLogic";
import PolicyTemplateCardComponent from "./PolicyTemplateCardComponent.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ templates: PolicyTemplate[]; loading: boolean }>(),
	emit = defineEmits<{ use: [template: PolicyTemplate]; ai: [] }>();
const selected = ref(new Set<string>()),
	tags = computed(() => templateTagCounts(props.templates)),
	filtered = computed(() => props.templates.filter((t) => templateHasTags(t, selected.value)));
function toggle(tag: string) {
	const next = new Set(selected.value);
	if (next.has(tag)) next.delete(tag);
	else next.add(tag);
	selected.value = next;
}
</script>
<template>
	<div v-if="loading" class="policy-template-loading"><UiSpinner :size="32" /><span>Loading policy templates...</span></div>
	<div v-else class="policy-templates">
		<header>
			<div>
				<h2>Policy Templates</h2>
				<p>Start with a pre-configured policy template to quickly set up guardrails for your organization.</p>
			</div>
			<UiButton @click="emit('ai')">
				<template #icon
					><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
						<path
							d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1zm4 7l.75 1.75L14.5 10.5l-1.75.75L12 13l-.75-1.75L9.5 10.5l1.75-.75L12 8zM4 9l.75 1.75L6.5 11.5l-1.75.75L4 14l-.75-1.75L1.5 11.5l1.75-.75L4 9z"
						/></svg
				></template>
				Use AI to find templates</UiButton
			>
		</header>
		<div class="policy-template-content">
			<aside v-if="tags.length">
				<div class="policy-template-sticky">
					<header>
						<strong>Categories</strong><button v-if="selected.size" @click="selected = new Set()">Clear all</button>
					</header>
					<label v-for="[tag, count] in tags" :key="tag" :class="{ 'is-selected': selected.has(tag) }"
						><span><UiCheckbox :model-value="selected.has(tag)" :label="tag" @update:model-value="toggle(tag)" />{{ tag }}</span
						><small>{{ count }}</small></label
					>
				</div>
			</aside>
			<main>
				<p v-if="selected.size" class="policy-template-count">Showing {{ filtered.length }} of {{ templates.length }} templates</p>
				<div class="policy-template-grid">
					<PolicyTemplateCardComponent
						v-for="template in filtered"
						:key="template.id"
						:template="template"
						@use="emit('use', template)"
					/>
				</div>
				<div v-if="!filtered.length" class="policy-template-empty">
					<p>No templates match the selected filters.</p>
					<button @click="selected = new Set()">Clear all filters</button>
				</div>
			</main>
		</div>
	</div>
</template>
