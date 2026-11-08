<script setup lang="ts">
import { computed, ref } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { FIELD_GROUPS, MCP_REQUIRED_FIELD_DEFS } from "../support/McpStandardsSupport";
const required = defineModel<string[]>({ required: true });
const props = defineProps<{ saving: boolean; save: () => Promise<void> }>();
const expanded = ref(false),
	active = computed(() => MCP_REQUIRED_FIELD_DEFS.filter((field) => required.value.includes(field.key)));
function toggle(key: string) {
	required.value = required.value.includes(key) ? required.value.filter((value) => value !== key) : [...required.value, key];
}
async function persist() {
	await props.save();
	expanded.value = false;
}
</script>
<template>
	<section class="tools-mcp-submission-rules">
		<button type="button" class="tools-mcp-rules-heading" @click="expanded = !expanded">
			<span
				><UiLucideIcon name="Settings" :size="16" /><strong>Submission Rules</strong
				><small v-if="active.length">({{ active.length }} required field{{ active.length !== 1 ? "s" : "" }})</small
				><i v-else>no rules set</i></span
			><span
				><template v-if="!expanded"
					><b v-for="field in active" :key="field.key"><UiLucideIcon name="Check" :size="12" />{{ field.label }}</b></template
				><UiLucideIcon :name="expanded ? 'ChevronUp' : 'ChevronDown'" :size="16"
			/></span>
		</button>
		<div v-if="expanded" class="tools-mcp-rules-editor">
			<p>
				Select which fields must be filled in before a submission is considered compliant. LiteLLM will show ✓ / ✗ for each rule on
				every submission card below.
			</p>
			<div class="tools-mcp-rules-grid">
				<section v-for="group in FIELD_GROUPS" :key="group.label">
					<h4>{{ group.label }}</h4>
					<label v-for="field in group.fields" :key="field.key"
						><input type="checkbox" :checked="required.includes(field.key)" @change="toggle(field.key)" /><span
							><strong>{{ field.label }}</strong
							><small>{{ field.description }}</small></span
						></label
					>
				</section>
			</div>
			<footer>
				<button type="button" :disabled="saving" @click="persist">{{ saving ? "Saving…" : "Save Rules" }}</button
				><button type="button" @click="expanded = false">Cancel</button>
			</footer>
		</div>
	</section>
</template>
