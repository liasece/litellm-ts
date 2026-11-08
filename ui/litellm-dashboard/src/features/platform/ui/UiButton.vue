<script setup lang="ts">
import { cloneVNode, h, Text, useSlots } from "vue";
import UiSpinner from "./UiSpinner.vue";
import type { UiAppearance, UiControlSize } from "./UiTypes";

const props = withDefaults(
	defineProps<{
		variant?: "default" | "primary" | "text" | "link" | "danger";
		size?: UiControlSize;
		appearance?: UiAppearance;
		loading?: boolean;
		disabled?: boolean;
		danger?: boolean;
		block?: boolean;
		type?: "button" | "submit" | "reset";
		autoInsertSpace?: boolean;
	}>(),
	{ variant: "default", size: "middle", appearance: "antd", type: "button", autoInsertSpace: true },
);
const slots = useSlots();
// AntD's bordered buttons insert a literal space between two Chinese characters.
const ButtonLabel = () => {
	const children = slots.default?.() ?? [];
	const node = children[0];
	const text = node?.children;
	const insert =
		props.appearance === "antd" &&
		props.autoInsertSpace &&
		!slots.icon &&
		props.variant !== "text" &&
		props.variant !== "link" &&
		children.length === 1 &&
		node &&
		(node.type === Text || typeof node.type === "string") &&
		typeof text === "string" &&
		/^[\u4E00-\u9FA5]{2}$/.test(text);
	if (props.appearance === "tremor") return h("span", { class: "ui-button__label" }, children);
	return children.map((child) => {
		if (child.type === Text) {
			const value =
				typeof child.children === "string"
					? insert
						? child.children.split("").join(" ")
						: child.children
					: String(child.children ?? "");
			return h("span", { class: "ui-button__label" }, value);
		}
		if (insert && child === node && typeof text === "string") {
			const spaced = cloneVNode(child);
			spaced.children = text.split("").join(" ");
			return spaced;
		}
		return child;
	});
};
</script>

<template>
	<button
		:type="type"
		class="ui-button"
		:class="[
			'ui-button--' + variant,
			'ui-button--' + size,
			'ui-button--' + appearance,
			{
				'ui-button--danger': danger,
				'ui-button--block': block,
				'ui-button--icon-only': !slots.default && Boolean(slots.icon || loading),
			},
		]"
		:disabled="disabled || loading"
		:aria-busy="loading || undefined"
	>
		<span
			v-if="appearance === 'tremor' && (loading || slots.icon)"
			class="ui-button__tremor-icon"
			:class="{ 'ui-button__tremor-icon--with-label': Boolean(slots.default) }"
		>
			<UiSpinner v-if="loading" :size="size === 'small' ? 16 : size === 'large' ? 24 : 20" />
			<slot v-else name="icon" />
		</span>
		<template v-else>
			<span v-if="loading || slots.icon" class="ui-button__icon">
				<UiSpinner v-if="loading" :size="14" />
				<slot v-else name="icon" />
			</span>
		</template>
		<ButtonLabel v-if="$slots.default" />
	</button>
</template>
