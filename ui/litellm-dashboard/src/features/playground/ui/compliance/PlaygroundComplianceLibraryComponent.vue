<script setup lang="ts">
import type { PlaygroundComplianceStore } from "../../stores/PlaygroundComplianceStore";
import type { ComplianceFramework } from "../../support/PlaygroundComplianceModels";
import { categoryIconNames } from "../../logic/PlaygroundComplianceLogic";
import { complianceFrameworks } from "../../data/PlaygroundComplianceData";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import PlaygroundComplianceDatasetComponent from "./PlaygroundComplianceDatasetComponent.vue";
const props = defineProps<{ store: PlaygroundComplianceStore }>(),
	state = props.store.state;
function count(framework: ComplianceFramework) {
	return framework.categories.reduce((sum, category) => sum + category.prompts.length, 0);
}
function selected(framework: ComplianceFramework) {
	return framework.categories.reduce(
		(sum, category) => sum + category.prompts.filter((prompt) => state.selected.has(prompt.id)).length,
		0,
	);
}
function custom(name: string) {
	return !complianceFrameworks.some((framework) => framework.name === name);
}
</script>
<template>
	<aside class="pg-compliance-library">
		<div class="pg-compliance-library__scroll">
			<header>
				<div class="pg-between">
					<h3>Test Prompts</h3>
					<small>{{ state.selected.size }}/{{ store.prompts.value.length }}</small>
				</div>
				<div class="pg-compliance-library__search">
					<UiLucideIcon name="Search" :size="14" /><input v-model="state.search" type="text" placeholder="Search prompts..." />
				</div>
				<div class="pg-between">
					<div class="pg-inline">
						<button
							type="button"
							class="pg-blue"
							@click="state.selected = new Set(store.prompts.value.map((prompt) => prompt.id))"
						>
							Select All</button
						><span>·</span><button type="button" @click="state.selected = new Set()">Clear</button>
					</div>
					<div class="pg-inline pg-inline--actions">
						<button
							type="button"
							:class="{ 'is-active': state.showAdd }"
							@click="
								state.showAdd = !state.showAdd;
								state.showCsv = false;
							"
						>
							<UiLucideIcon name="Plus" :size="12" />Add</button
						><button
							type="button"
							:class="{ 'is-active': state.showCsv }"
							@click="
								state.showCsv = !state.showCsv;
								state.showAdd = false;
							"
						>
							<UiLucideIcon name="Upload" :size="12" />CSV
						</button>
					</div>
				</div>
			</header>
			<PlaygroundComplianceDatasetComponent :store="store" />
			<div class="pg-compliance-library__frameworks">
				<div v-for="(framework, fi) in store.filtered.value" :key="framework.name + '-' + fi" class="pg-compliance-framework">
					<button
						type="button"
						class="pg-compliance-framework__heading"
						:aria-expanded="state.expandedFrameworks.has(framework.name)"
						@click="store.toggle('expandedFrameworks', framework.name)"
					>
						<UiLucideIcon
							:name="state.expandedFrameworks.has(framework.name) ? 'ChevronDown' : 'ChevronRight'"
							:size="16"
							class="pg-compliance-framework__chevron"
						/><UiLucideIcon
							:name="categoryIconNames[framework.icon] || 'ClipboardList'"
							:size="16"
							class="pg-compliance-framework__icon"
						/><span class="pg-compliance-framework__label"
							><span>{{ framework.name }}</span
							><span class="pg-compliance-framework__count">{{ count(framework) }} prompts</span></span
						><span v-if="selected(framework)" class="pg-compliance-count">{{ selected(framework) }}</span
						><button type="button" class="pg-compliance-framework__toggle" @click.stop="store.toggleFramework(framework)">
							{{ selected(framework) === count(framework) ? "Clear" : "All" }}
						</button>
					</button>
					<div v-if="state.expandedFrameworks.has(framework.name)" class="pg-compliance-categories">
						<div v-for="category in framework.categories" :key="category.name">
							<button
								type="button"
								class="pg-compliance-category"
								:aria-expanded="state.expandedCategories.has(category.name)"
								@click="store.toggle('expandedCategories', category.name)"
							>
								<UiLucideIcon
									:name="state.expandedCategories.has(category.name) ? 'ChevronDown' : 'ChevronRight'"
									:size="14"
								/><UiLucideIcon :name="categoryIconNames[category.icon] || 'ClipboardList'" :size="14" /><strong>{{
									category.name
								}}</strong
								><small>{{ category.prompts.length }}</small
								><span
									v-if="category.prompts.some((prompt) => state.selected.has(prompt.id))"
									class="pg-compliance-count"
									>{{ category.prompts.filter((prompt) => state.selected.has(prompt.id)).length }}</span
								></button
							><template v-if="state.expandedCategories.has(category.name)"
								><div class="pg-compliance-category__description">
									<p>{{ category.description }}</p>
									<button type="button" class="pg-blue" @click="store.toggleCategory(category)">
										{{ category.prompts.every((prompt) => state.selected.has(prompt.id)) ? "Clear" : "Select all" }}
									</button>
								</div>
								<label v-for="prompt in category.prompts" :key="prompt.id" class="pg-compliance-prompt"
									><input
										type="checkbox"
										:checked="state.selected.has(prompt.id)"
										@change="store.toggle('selected', prompt.id)" />
									<div>
										<p>{{ prompt.prompt }}</p>
										<span
											class="pg-compliance-badge"
											:class="prompt.expectedResult === 'fail' ? 'is-fail' : 'is-pass'"
											>{{ prompt.expectedResult === "fail" ? "Should Fail" : "Should Pass" }}</span
										>
									</div>
									<button
										v-if="custom(framework.name)"
										type="button"
										aria-label="Delete"
										@click.prevent.stop="store.deletePrompt(prompt.id)"
									>
										<UiLucideIcon name="Trash2" :size="12" /></button></label
							></template>
						</div>
					</div>
				</div>
			</div>
		</div>
	</aside>
</template>
