<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { PlaygroundComplianceStore } from "../../stores/PlaygroundComplianceStore";
import { policyOptions } from "../../logic/PlaygroundOptionsLogic";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
const props = defineProps<{ store: PlaygroundComplianceStore; disabled?: boolean }>(),
	state = props.store.state,
	end = ref<HTMLElement>(),
	policies = computed(() => policyOptions(props.store.catalog.state.policies));
const label = computed(() => {
	const parts = [];
	if (state.policies.length) parts.push(state.policies.length + " " + (state.policies.length === 1 ? "policy" : "policies"));
	if (state.guardrails.length) parts.push(state.guardrails.length + " " + (state.guardrails.length === 1 ? "guardrail" : "guardrails"));
	return parts.length ? "Test " + parts.join(" & ") : "Test";
});
function key(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		if (!props.disabled) void props.store.quickTest();
	}
}
watch(
	() => state.quickMessages,
	async () => {
		await nextTick();
		end.value?.scrollIntoView({ behavior: "smooth", block: "end" });
	},
);
</script>
<template>
	<div class="pg-compliance-quick">
		<header>
			<div v-if="state.policies.length || state.guardrails.length" class="pg-inline">
				<span>Testing against:</span
				><span v-for="id in state.policies" :key="id" class="pg-compliance-selected-policy">{{
					policies.find((policy) => policy.value === id)?.label || id
				}}</span
				><span v-for="id in state.guardrails" :key="id" class="pg-compliance-selected-guardrail">{{ id }}</span>
			</div>
			<p v-else>No policies or guardrails selected — select above to test against specific rules.</p>
		</header>
		<div class="pg-compliance-quick__messages">
			<div v-if="!state.quickMessages.length" class="pg-compliance-empty">
				<span><UiLucideIcon name="MessageSquare" :size="20" /></span>
				<p>Type a prompt below to quickly test it.</p>
			</div>
			<div
				v-for="message in state.quickMessages"
				:key="message.id"
				class="pg-compliance-quick__message"
				:class="'is-' + (message.type === 'user' ? 'user' : message.result)"
			>
				<div>
					<p>
						<strong v-if="message.type === 'system'"
							><UiLucideIcon :name="message.result === 'blocked' ? 'X' : 'CheckCircle2'" :size="12" />{{
								message.result === "blocked" ? "Blocked" : "Allowed"
							}}
							<span>—</span></strong
						>{{ message.text
						}}<span v-if="message.type === 'system' && message.returnedText != null" class="pg-compliance-quick__returned"
							><span>Returned: </span><b>{{ message.returnedText }}</b></span
						>
					</p>
				</div>
			</div>
			<div v-if="state.quickLoading" class="pg-compliance-quick__loading"><UiSpinner :size="14" /></div>
			<div ref="end"></div>
		</div>
		<footer>
			<div class="pg-compliance-quick__input">
				<textarea v-model="state.input" rows="3" placeholder="Enter text to test..." @keydown="key" />
				<div class="pg-between">
					<span>Press <kbd>Enter</kbd> to submit · <kbd>Shift+Enter</kbd> for new line</span><span>{{ state.input.length }}</span>
				</div>
			</div>
			<button
				type="button"
				class="pg-compliance-primary"
				:disabled="!state.input.trim() || state.quickLoading || disabled"
				@click="store.quickTest"
			>
				<UiSpinner v-if="state.quickLoading" :size="16" /><UiLucideIcon v-else name="Send" :size="16" />{{ label }}
			</button>
		</footer>
	</div>
</template>
