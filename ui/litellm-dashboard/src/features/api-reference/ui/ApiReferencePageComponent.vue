<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import examplesData from "../data/ApiReferenceExamples.json";
import { apiReferenceBaseUrl } from "../logic/ApiReferenceLogic";
import type { ApiReferenceExample } from "../support/ApiReferenceModels";
import ApiReferenceCodeComponent from "./ApiReferenceCodeComponent.vue";
const application = useApplicationStore(),
	active = ref("0"),
	block = ref<HTMLElement>();
const scrollCleanups: (() => void)[] = [];
function syncCodeScroll(pre: HTMLElement) {
	const frame = pre.closest(".content-code-block");
	if (!frame) return;
	// 隐藏的 tab 面板宽度为 0，保持渐隐，等切换后再按真实滚动位置判断。
	const atEnd = pre.clientWidth > 0 && pre.scrollLeft + pre.clientWidth >= pre.scrollWidth - 2;
	frame.classList.toggle("content-code-block--at-end", atEnd);
}
/** 代码块在窄屏内横向滚动；pre 可聚焦，右缘渐隐提示还有内容，滑到底后撤掉渐隐。 */
onMounted(() => {
	for (const pre of block.value?.querySelectorAll<HTMLElement>(".content-code-block pre") ?? []) {
		pre.tabIndex = 0;
		pre.setAttribute("role", "region");
		pre.setAttribute("aria-label", "Code sample, scroll horizontally to read full lines");
		const onScroll = () => syncCodeScroll(pre);
		pre.addEventListener("scroll", onScroll, { passive: true });
		scrollCleanups.push(() => pre.removeEventListener("scroll", onScroll));
		syncCodeScroll(pre);
	}
});
onBeforeUnmount(() => {
	for (const cleanup of scrollCleanups) cleanup();
	scrollCleanups.length = 0;
});
const examples: readonly ApiReferenceExample[] = examplesData;
const baseUrl = computed(() => apiReferenceBaseUrl(application.state.proxySettings));
</script>
<template>
	<div class="api-reference-grid">
		<div ref="block" class="api-reference-block">
			<div class="api-reference-heading">
				<p>OpenAI Compatible Proxy: API Reference</p>
				<a
					href="https://docs.litellm.ai/docs/proxy/user_keys"
					target="_blank"
					rel="noopener noreferrer"
					title="Open documentation in a new tab"
					class="api-reference-doc-link"
					><span>API Reference Docs</span
					><UiLucideIcon name="ExternalLink" :size="24" aria-hidden="true" style="width: 16px; height: 16px; opacity: 0.8" /><span
						class="api-reference-sr-only"
						>(opens in a new tab)</span
					></a
				>
			</div>
			<p class="api-reference-description">
				LiteLLM is OpenAI Compatible. This means your API Key works with the OpenAI SDK. Just replace the base_url to point to your
				litellm proxy. Example Below
			</p>
			<UiTabs v-model="active" appearance="tremor" :items="examples.map((example) => ({ key: example.key, label: example.label }))"
				><div v-for="example in examples" :key="example.key" :hidden="active !== example.key">
					<ApiReferenceCodeComponent :example="example" :base-url="baseUrl" /></div
			></UiTabs>
		</div>
	</div>
</template>
<style>
.api-reference-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	margin-top: 8px;
	width: 100%;
	gap: 8px;
	padding: 16px;
}
.api-reference-block {
	margin-bottom: 20px;
	min-width: 0;
}
.api-reference-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 8px 12px;
}
.api-reference-heading > p {
	margin: 0;
	min-width: 0;
	font-size: 24px;
	line-height: 32px;
	font-weight: 600;
	color: #111827;
}
.api-reference-doc-link {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 8px;
	margin-left: 0;
	padding: 8px 14px;
	border: 1px solid #e4e4e7;
	border-radius: 12px;
	background: #ffffffcc;
	box-shadow: 0 1px 2px #0000000d;
	color: #3f3f46;
	font-size: 14px;
	line-height: 20px;
	font-weight: 500;
	text-decoration: none;
}
.api-reference-doc-link:hover {
	background: #fff;
}
.api-reference-doc-link:focus-visible {
	outline: 2px solid #3b82f6;
	outline-offset: 2px;
}
.api-reference-doc-link:active {
	transform: translateY(0.5px);
}
.api-reference-description {
	margin: 8px 0;
	font-size: 12.4px;
	line-height: 18.4px;
	color: #6b7280;
}
.api-reference-sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border-width: 0;
}
@media (min-width: 640px) {
	.api-reference-grid {
		height: 80vh;
		padding: 32px;
	}
}
/* 手机端：标题与文档链接纵向排列，标签页换行而不是被裁切，复制按钮放大到触屏尺寸。 */
@media (max-width: 640px) {
	.api-reference-heading {
		align-items: flex-start;
		flex-direction: column;
	}
	.api-reference-heading > p {
		font-size: 22px;
		line-height: 30px;
	}
	.api-reference-doc-link {
		min-height: 40px;
	}
	.api-reference-block .ui-tabs__list {
		flex-wrap: wrap;
		overflow-x: visible;
		overflow-y: visible;
		row-gap: 2px;
	}
	.api-reference-block .ui-tabs--tremor .ui-tabs__tab {
		flex: 0 0 auto;
		max-width: 100%;
		white-space: nowrap;
		overflow: visible;
		text-overflow: clip;
	}
	.api-reference-block .content-code-block > button {
		width: 40px;
		height: 40px;
		padding: 12px;
	}
	/* 复制按钮悬浮在代码块右上角，给首行留出空间避免遮住代码。 */
	.api-reference-block .content-code-block pre {
		padding-top: 3.5rem !important;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior-x: contain;
	}
	/* 右缘渐隐提示代码可以横向滑动，避免看起来像被切断。 */
	.api-reference-block .content-code-block::after {
		content: "";
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 32px;
		border-radius: 0 8px 8px 0;
		background: linear-gradient(to right, rgb(250 250 250 / 0%), #fafafa);
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	.api-reference-block .content-code-block--at-end::after {
		opacity: 0;
	}
}
</style>
