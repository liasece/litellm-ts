<script setup lang="ts">
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
withDefaults(defineProps<{ type: "input" | "output"; tokens?: number; cost?: number; turnCount?: number; collapsed: boolean }>(), {
	tokens: undefined,
	cost: undefined,
	turnCount: undefined,
});
defineEmits<{ toggle: []; copy: [] }>();
const money = useMoneyFormatter();
</script>
<template>
	<div class="pretty-section-header" :class="{ 'pretty-section-header--collapsed': collapsed }" @click="$emit('toggle')">
		<div class="pretty-section-header__left">
			<UiIcon :name="collapsed ? 'RightOutlined' : 'DownOutlined'" class="pretty-section-header__arrow" /><UiIcon
				v-if="type === 'input'"
				name="MessageOutlined"
				class="pretty-section-header__message"
			/><span v-else class="pretty-section-header__sparkle">✨</span
			><span class="pretty-section-header__title">{{ type === "input" ? "Input" : "Output" }}</span
			><span v-if="tokens !== undefined" class="pretty-section-header__metric">{{ tokens.toLocaleString() }} tokens</span
			><span v-if="cost !== undefined" class="pretty-section-header__metric">{{ money(cost, 6) }}</span
			><span v-if="turnCount && turnCount > 0" class="pretty-section-header__metric"
				>{{ turnCount }} turn{{ turnCount === 1 ? "" : "s" }}</span
			>
		</div>
		<UiButton variant="text" size="small" title="Copy" aria-label="Copy" @click.stop="$emit('copy')"
			><UiIcon name="CopyOutlined"
		/></UiButton>
	</div>
</template>
