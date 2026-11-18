<script setup lang="ts">
import { computed } from "vue";
import type { UpstreamErrorView } from "../../logic/LogDetailsUpstreamErrorsLogic";

const props = defineProps<{ errors: readonly UpstreamErrorView[] }>();
// 冷却短路请求没有自己的上游交换，列表里只有触发冷却的那次错误；此时标题改成
// 「Cooldown cause」更贴近事实，避免让人以为本次请求真的打到过上游。
const onlyCooldown = computed(() => props.errors.length > 0 && props.errors.every((error) => error.kind === "cooldown"));
const title = computed(() => (onlyCooldown.value ? "Cooldown cause" : `Upstream errors`));
</script>

<template>
	<section v-if="errors.length" class="ld-upstream-errors ld-surface">
		<div class="ld-upstream-errors__title">{{ title }} ({{ errors.length }})</div>
		<ol class="ld-upstream-errors__list">
			<li v-for="(error, index) in errors" :key="index" class="ld-upstream-errors__item">
				<div class="ld-upstream-errors__meta">
					<strong>{{ error.label }}</strong>
					<span class="ld-upstream-errors__code"
						>{{ error.type }}<template v-if="error.code"> · {{ error.code }}</template></span
					>
				</div>
				<div class="ld-upstream-errors__message">{{ error.message }}</div>
				<div v-if="error.detail" class="ld-upstream-errors__detail">{{ error.detail }}</div>
				<div v-if="error.url" class="ld-upstream-errors__url ld-truncate" :title="error.url">{{ error.url }}</div>
			</li>
		</ol>
	</section>
</template>
