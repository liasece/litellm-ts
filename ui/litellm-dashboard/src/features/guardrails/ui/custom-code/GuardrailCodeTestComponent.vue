<script setup lang="ts">
import { computed } from "vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { TEST_INPUT_EXAMPLES } from "../../data/GuardrailCustomCodeExamples";
import { legacyGuardrailText, guardrailStrings } from "../../support/GuardrailClipboardSupport";
const expanded = defineModel<boolean>("expanded", { required: true }),
	input = defineModel<string>("input", { required: true }),
	props = defineProps<{ testing: boolean; result: Record<string, unknown> | null }>(),
	emit = defineEmits<{ test: [] }>(),
	resultClass = computed(() => (props.result?.error ? "error" : String(props.result?.action ?? ""))),
	preview = computed(() => guardrailStrings(props.result?.texts)[0] ?? "");
function example(key: keyof typeof TEST_INPUT_EXAMPLES) {
	input.value = JSON.stringify(TEST_INPUT_EXAMPLES[key].data, null, 2);
}
const testInputPlaceholder = '{"texts": ["test message"], ...}';
</script>
<template>
	<section class="guardrail-code-test">
		<button type="button" class="guardrail-code-test-heading" @click="expanded = !expanded">
			<UiIcon name="CaretRightOutlined" :size="12" :style="{ transform: expanded ? 'rotate(90deg)' : 'none' }" /><UiIcon
				name="PlayCircleOutlined"
			/>Test Your Guardrail
		</button>
		<div v-if="expanded" class="guardrail-code-test-body">
			<header>
				<label>Test Input (JSON)</label>
				<div>
					<span>Load example:</span><button class="pre-call" type="button" @click="example('pre_call')">Pre-call</button
					><button class="pre-mcp" type="button" @click="example('pre_mcp_call')">Pre MCP</button
					><button class="post-call" type="button" @click="example('post_call')">Post-call</button>
				</div>
			</header>
			<div class="guardrail-code-input-help">
				<div><strong>texts</strong>: Message content (always)</div>
				<div><strong>images</strong>: Base64 images (vision)</div>
				<div>
					<strong>tools</strong>: Tool definitions <span class="guardrail-orange">(pre_call)</span>, MCP as OpenAI tool
					<span class="guardrail-purple">(pre_mcp_call)</span>
				</div>
				<div><strong>tool_calls</strong>: LLM tool calls <span class="guardrail-green">(post_call)</span></div>
				<div><strong>structured_messages</strong>: Full messages <span class="guardrail-orange">(pre_call)</span></div>
				<div><strong>model</strong>: Model name (always)</div>
			</div>
			<UiInput v-model="input" multiline :rows="8" :placeholder="testInputPlaceholder" class="guardrail-code-test-input" />
			<div class="guardrail-code-run">
				<UiButton
					appearance="tremor"
					variant="primary"
					size="small"
					data-guardrail-size="xs"
					:disabled="testing"
					@click="emit('test')"
					><template #icon><UiIcon name="PlayCircleOutlined" /></template>{{ testing ? "Running..." : "Run Test" }}</UiButton
				><span v-if="result" :class="['guardrail-code-test-result', resultClass]"
					><UiIcon :name="result.error || result.action === 'block' ? 'CloseCircleOutlined' : 'CheckCircleOutlined'" /><template
						v-if="result.error"
						><strong v-if="result.error_type">[{{ legacyGuardrailText(result.error_type) }}] </strong
						>{{ legacyGuardrailText(result.error) }}</template
					><template v-else-if="result.action === 'allow'">Allowed</template
					><template v-else-if="result.action === 'block'">Blocked: {{ legacyGuardrailText(result.reason) }}</template
					><template v-else-if="result.action === 'modify'"
						>Modified<small v-if="preview"
							>→ {{ preview.substring(0, 50) }}{{ preview.length > 50 ? "..." : "" }}</small
						></template
					><template v-else>{{ legacyGuardrailText(result.action) || "Unknown" }}</template></span
				>
			</div>
		</div>
	</section>
</template>
