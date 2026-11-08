<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { PRIMITIVES } from "../../data/GuardrailCustomCodeData";
const expanded = ref(new Set(["Return Values"])),
	copied = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
function toggle(name: string) {
	const next = new Set(expanded.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	expanded.value = next;
}
async function copy(value: string) {
	try {
		await navigator.clipboard.writeText(value);
		copied.value = value;
		clearTimeout(timer);
		timer = setTimeout(() => (copied.value = ""), 2000);
	} catch {
		return;
	}
}
onBeforeUnmount(() => clearTimeout(timer));
</script>
<template>
	<aside class="guardrail-primitives">
		<h3><UiIcon name="CodeOutlined" />Available Primitives</h3>
		<p>Click to copy functions to clipboard</p>
		<section v-for="(items, name) in PRIMITIVES" :key="name">
			<button class="guardrail-primitive-category" type="button" @click="toggle(name)">
				<span>{{ name }}</span
				><UiIcon name="RightOutlined" :size="12" :style="{ transform: expanded.has(name) ? 'rotate(90deg)' : 'none' }" />
			</button>
			<div v-if="expanded.has(name)" class="guardrail-primitive-list">
				<button
					v-for="primitive in items"
					:key="primitive.name"
					type="button"
					:class="{ copied: copied === primitive.name }"
					@click="copy(primitive.name)"
				>
					<span v-if="copied === primitive.name"><UiIcon name="CheckCircleOutlined" />Copied!</span
					><template v-else
						><code>{{ primitive.name }}</code
						><small>{{ primitive.desc }}</small></template
					>
				</button>
			</div>
		</section>
	</aside>
</template>
