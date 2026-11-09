<script setup lang="ts">
import { computed, ref } from "vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import PrivacyPlaceholderText from "./PrivacyPlaceholderText.vue";
defineOptions({ name: "JsonTreeNode" });
const props = withDefaults(
	defineProps<{
		value: unknown;
		field?: string;
		depth: number;
		last: boolean;
		rootElement?: HTMLElement;
		initialExpanded?: boolean;
	}>(),
	{ field: undefined, rootElement: undefined, initialExpanded: true },
);
const expanded = ref(props.initialExpanded);
const expander = ref<HTMLElement>();
const identity = nextUiIdentity("json-contents");
const collection = computed(() => props.value !== null && typeof props.value === "object" && !(props.value instanceof Date));
const array = computed(() => Array.isArray(props.value));
const entries = computed<Array<[string | undefined, unknown]>>(() => {
	if (Array.isArray(props.value)) return props.value.map((value) => [undefined, value]);
	if (props.value !== null && typeof props.value === "object" && !(props.value instanceof Date)) return Object.entries(props.value);
	return [];
});
const primitive = computed(() => {
	const value = props.value;
	if (value === null) return { text: "null", kind: "null" };
	if (value === undefined) return { text: "undefined", kind: "undefined" };
	if (typeof value === "string") return { text: '"' + value + '"', kind: "string" };
	if (typeof value === "boolean") return { text: value ? "true" : "false", kind: "boolean" };
	if (typeof value === "number") return { text: String(value), kind: "number" };
	if (typeof value === "bigint") return { text: String(value) + "n", kind: "number" };
	if (value instanceof Date) return { text: value.toISOString(), kind: "other" };
	if (typeof value === "function") return { text: "function() { }", kind: "other" };
	return { text: String(value), kind: "other" };
});
function focus() {
	const previous = props.rootElement?.querySelector<HTMLElement>('[role="button"][tabindex="0"]');
	if (previous) previous.tabIndex = -1;
	if (expander.value) {
		expander.value.tabIndex = 0;
		expander.value.focus();
	}
}
function toggle() {
	expanded.value = !expanded.value;
	focus();
}
function keyboard(event: KeyboardEvent) {
	if (event.key === "Enter" || event.key === " ") {
		event.preventDefault();
		toggle();
	} else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
		event.preventDefault();
		expanded.value = event.key === "ArrowRight";
	} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
		event.preventDefault();
		const buttons = [...(props.rootElement?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])];
		if (!buttons.length) return;
		const current = buttons.findIndex((button) => button.tabIndex === 0);
		if (current < 0) return;
		const next = (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
		buttons[current].tabIndex = -1;
		buttons[next].tabIndex = 0;
		buttons[next].focus();
	}
}
</script>
<template>
	<div class="json-content__node" role="treeitem" :aria-expanded="collection && entries.length ? expanded : undefined">
		<template v-if="collection">
			<span
				v-if="entries.length"
				ref="expander"
				class="json-content__expander"
				:class="expanded ? 'json-content__expander--open' : 'json-content__expander--closed'"
				role="button"
				:aria-label="expanded ? 'collapse JSON' : 'expand JSON'"
				:aria-expanded="expanded"
				:aria-controls="expanded ? identity : undefined"
				:tabindex="depth === 0 ? 0 : -1"
				@click="toggle"
				@keydown="keyboard"
			/>
			<span
				v-if="field !== undefined"
				class="json-content__label"
				:class="{ 'json-content__label--clickable': entries.length }"
				@click="entries.length && toggle()"
				@keydown="entries.length && keyboard($event)"
				>{{ field === "" ? '""' : field }}:</span
			>
			<span class="json-content__punctuation">{{ array ? "[" : "{" }}</span>
			<ul v-if="expanded && entries.length" :id="identity" class="json-content__children" role="group">
				<JsonTreeNode
					v-for="([key, child], index) in entries"
					:key="key ?? index"
					:value="child"
					:field="key"
					:depth="depth + 1"
					:last="index === entries.length - 1"
					:root-element="rootElement"
					:initial-expanded="initialExpanded"
				/>
			</ul>
			<span v-else-if="entries.length" class="json-content__collapsed" @click="toggle" @keydown="keyboard" />
			<span class="json-content__punctuation">{{ array ? "]" : "}" }}</span
			><span v-if="!last" class="json-content__punctuation">,</span>
		</template>
		<template v-else
			><span v-if="field !== undefined" class="json-content__label">{{ field === "" ? '""' : field }}:</span
			><span :class="'json-content__value--' + primitive.kind"><PrivacyPlaceholderText :text="primitive.text" /></span
			><span v-if="!last" class="json-content__punctuation">,</span></template
		>
	</div>
</template>
