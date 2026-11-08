<script setup lang="ts">
import { computed, ref } from "vue";
import type { ComparisonInstance, ComparisonSettings } from "../../support/PlaygroundCompareModels";
import type { PlaygroundCompareStore } from "../../stores/PlaygroundCompareStore";
import type { UiValue } from "../../../platform/ui/UiTypes";
import { modelOptions } from "../../data/PlaygroundEndpointData";
import { tagOptions, vectorOptions, guardrailOptions } from "../../logic/PlaygroundOptionsLogic";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import PlaygroundComparisonMessagesComponent from "./PlaygroundComparisonMessagesComponent.vue";
const props = defineProps<{ comparison: ComparisonInstance; store: PlaygroundCompareStore }>(),
	popover = ref<InstanceType<typeof UiPopover>>(),
	agent = computed(() => props.store.state.endpoint === "/a2a");
const options = computed(() =>
	agent.value
		? props.store.catalog.state.agents.map((item) => ({ value: item.agent_name, label: item.agent_name || item.agent_id }))
		: modelOptions(props.store.catalog.state.models),
);
function array(value: UiValue | UiValue[] | null) {
	return value === null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}
function setting<K extends keyof ComparisonSettings>(key: K, value: ComparisonSettings[K]) {
	props.store.settings(props.comparison.id, key, value);
}
function numeric(event: Event) {
	return Number((event.target as HTMLInputElement).value);
}
</script>
<template>
	<section class="pg-compare-panel">
		<header>
			<div class="pg-compare-panel__selection">
				<div class="pg-grow">
					<UiSelect
						:model-value="agent ? comparison.agent || null : comparison.model || null"
						:options="options"
						:loading="store.catalog.state.loading"
						searchable
						:placeholder="agent ? 'Select an agent' : 'Select a model'"
						@update:model-value="
							store.update(comparison.id, agent ? { agent: String($event || '') } : { model: String($event || '') })
						"
					/>
				</div>
				<UiPopover ref="popover" trigger="click" placement="bottom"
					><button type="button" aria-label="Comparison settings"><UiLucideIcon name="Settings" :size="18" /></button
					><template #content
						><div class="pg-compare-settings">
							<button
								type="button"
								class="pg-compare-settings__close"
								aria-label="Close comparison settings"
								@click="popover?.hide()"
							>
								<UiLucideIcon name="X" :size="14" /></button
							><UiCheckbox :model-value="comparison.applyAcrossModels" @update:model-value="store.sync(comparison.id, $event)"
								>Sync Settings Across Models</UiCheckbox
							>
							<hr />
							<h4>General Settings</h4>
							<label
								>Tags<UiSelect
									:model-value="comparison.tags"
									clearable
									max-tag-count="responsive"
									:options="tagOptions(store.catalog.state.tags)"
									multiple
									searchable
									creatable
									:token-separators="[',']"
									placeholder="Select or create tags"
									@update:model-value="setting('tags', array($event))" /></label
							><label
								>Vector Stores<UiSelect
									:model-value="comparison.vectorStores"
									clearable
									:options="vectorOptions(store.catalog.state.vectors)"
									multiple
									searchable
									placeholder="Select vector stores"
									@update:model-value="setting('vectorStores', array($event))" /></label
							><label
								>Guardrails<UiSelect
									:model-value="comparison.guardrails"
									clearable
									:options="guardrailOptions(store.catalog.state.guardrails)"
									multiple
									searchable
									placeholder="Select guardrails"
									@update:model-value="setting('guardrails', array($event))"
							/></label>
							<h4>Advanced Settings</h4>
							<UiCheckbox
								:model-value="comparison.useAdvancedParams"
								@update:model-value="setting('useAdvancedParams', $event)"
								>Use Advanced Parameters</UiCheckbox
							>
							<div :style="{ opacity: comparison.useAdvancedParams ? 1 : 0.4 }">
								<label
									><div class="pg-between">
										Temperature<span>{{ comparison.temperature.toFixed(2) }}</span>
									</div>
									<input
										type="range"
										:value="comparison.temperature"
										aria-label="Comparison temperature"
										min="0"
										max="2"
										step=".01"
										:disabled="!comparison.useAdvancedParams"
										@input="setting('temperature', numeric($event))" /></label
								><label
									><div class="pg-between">
										Max Tokens<span>{{ comparison.maxTokens }}</span>
									</div>
									<input
										type="range"
										:value="comparison.maxTokens"
										aria-label="Comparison max tokens"
										min="1"
										max="32768"
										step="1"
										:disabled="!comparison.useAdvancedParams"
										@input="setting('maxTokens', numeric($event))"
								/></label>
							</div></div></template
				></UiPopover>
			</div>
			<button
				v-if="store.state.comparisons.length > 1"
				type="button"
				class="pg-compare-panel__remove"
				aria-label="Remove comparison"
				@click="store.remove(comparison.id)"
			>
				<UiLucideIcon name="X" :size="18" />
			</button>
		</header>
		<div class="pg-compare-panel__messages">
			<PlaygroundComparisonMessagesComponent :messages="comparison.history.state.messages" :loading="comparison.loading" />
		</div>
	</section>
</template>
