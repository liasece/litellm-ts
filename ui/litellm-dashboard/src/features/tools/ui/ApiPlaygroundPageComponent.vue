<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createTransformRequestStore } from "../stores/TransformRequestStore";
import { transformExampleCurl } from "../support/TransformExamples";
import "../styles/TransformRequestStyles.css";
const auth = useAuthenticationStore(),
	store = createTransformRequestStore(),
	{ state } = store;
let disposed = false;
async function transform() {
	await store.transform(auth.isAuthorized.value);
	if (disposed) return;
	if (state.error) notificationManager.fromBackend(state.error);
	else if (state.message === "Transformed request received in unexpected format") notificationManager.info(state.message);
	else if (state.message) notificationManager.success(state.message);
}
async function copy() {
	await store.copy();
	if (!disposed) notificationManager.success("Copied to clipboard");
}
function keydown(event: KeyboardEvent) {
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
		event.preventDefault();
		transform();
	}
}
onBeforeUnmount(() => {
	disposed = true;
	store.dispose();
});
</script>
<template>
	<main class="tools-transform">
		<h3>Playground</h3>
		<p class="tools-transform-intro">See how LiteLLM transforms your request for the specified provider.</p>
		<div class="tools-transform-panels">
			<section class="tools-transform-original">
				<header>
					<h2>Original Request</h2>
					<p>The request you would send to LiteLLM /chat/completions endpoint.</p>
				</header>
				<textarea
					v-model="state.request"
					aria-label="Original request JSON"
					placeholder="Press Cmd/Ctrl + Enter to transform"
					@keydown="keydown"
				/>
				<footer>
					<UiButton variant="primary" :style="{ backgroundColor: '#000' }" :loading="state.loading" @click="transform"
						><span>Transform</span><span>→</span></UiButton
					>
				</footer>
			</section>
			<section class="tools-transform-result">
				<header>
					<h2>Transformed Request</h2>
					<p>How LiteLLM transforms your request for the specified provider.</p>
					<br />
					<p class="tools-transform-sensitive">Note: Sensitive headers are not shown.</p>
				</header>
				<div class="tools-transform-code">
					<pre>{{ state.response || transformExampleCurl }}</pre>
					<UiButton variant="text" size="small" aria-label="Copy transformed request" @click="copy"
						><template #icon><UiIcon name="CopyOutlined" /></template
					></UiButton>
				</div>
			</section>
		</div>
		<footer class="tools-transform-feedback">
			<p>
				Found an error? File an issue
				<a href="https://github.com/BerriAI/litellm/issues" target="_blank" rel="noopener noreferrer">here</a>.
			</p>
		</footer>
	</main>
</template>
