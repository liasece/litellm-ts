<script setup lang="ts">
import UiCard from "../../../platform/ui/UiCard.vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiEmptyState from "../../../platform/ui/UiEmptyState.vue";
import type { ToolPermissionConfig, ToolPermissionRule } from "../../support/GuardrailModels";
const value = defineModel<ToolPermissionConfig>({ required: true });
withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
function add() {
	value.value = {
		...value.value,
		rules: [
			...value.value.rules,
			{ id: "rule_" + Math.random().toString(36).slice(2, 8), decision: "allow", allowed_param_patterns: undefined },
		],
	};
}
function rule(index: number, patch: Partial<ToolPermissionRule>) {
	value.value = { ...value.value, rules: value.value.rules.map((row, i) => (i === index ? { ...row, ...patch } : row)) };
}
function inputRule(index: number, field: "id" | "tool_name" | "tool_type", input: unknown) {
	const text = String(input ?? "");
	rule(index, { [field]: field !== "id" && !text.trim() ? undefined : text });
}
function decision(index: number, input: unknown) {
	if (input === "allow" || input === "deny") rule(index, { decision: input });
}
function entry(index: number, entryIndex: number, field: "key" | "value" | "remove", input?: unknown) {
	const target = value.value.rules[index];
	if (!target) return;
	const entries = Object.entries(target.allowed_param_patterns ?? {});
	if (field === "remove") entries.splice(entryIndex, 1);
	else if (entries[entryIndex])
		entries[entryIndex] =
			field === "key" ? [String(input ?? ""), entries[entryIndex][1]] : [entries[entryIndex][0], String(input ?? "")];
	const object = Object.fromEntries(entries);
	rule(index, { allowed_param_patterns: Object.keys(object).length ? object : undefined });
}
function select(field: "default_action" | "on_disallowed_action", input: unknown) {
	if (typeof input === "string") value.value = { ...value.value, [field]: input };
}
</script>
<template>
	<UiCard class="guardrail-tool-permissions"
		><header>
			<div>
				<h2>LiteLLM Tool Permission Guardrail</h2>
				<p>Provide regex patterns (e.g., ^mcp__github_.*$) for tool names or types and optionally constrain payload fields.</p>
			</div>
			<UiButton v-if="!disabled" variant="primary" @click="add"
				><template #icon><UiIcon name="PlusOutlined" /></template>Add Rule</UiButton
			>
		</header>
		<hr />
		<UiEmptyState v-if="!value.rules.length" description="No tool rules added yet" />
		<div v-else class="guardrail-tool-rules">
			<UiCard v-for="(item, index) in value.rules" :key="item.id || index" class="guardrail-tool-rule"
				><header>
					<strong>Rule {{ index + 1 }}</strong
					><UiButton variant="text" danger :disabled="disabled" @click="value.rules = value.rules.filter((_, i) => i !== index)"
						><UiIcon name="DeleteOutlined" />Remove</UiButton
					>
				</header>
				<div class="guardrail-rule-grid">
					<label
						>Rule ID<UiInput
							:model-value="item.id"
							:disabled="disabled"
							placeholder="unique_rule_id"
							@update:model-value="inputRule(index, 'id', $event)" /></label
					><label
						>Tool Name (optional)<UiInput
							:model-value="item.tool_name ?? ''"
							:disabled="disabled"
							placeholder="^mcp__github_.*$"
							@update:model-value="inputRule(index, 'tool_name', $event)"
					/></label>
				</div>
				<div class="guardrail-rule-grid">
					<label
						>Tool Type (optional)<UiInput
							:model-value="item.tool_type ?? ''"
							:disabled="disabled"
							placeholder="^function$"
							@update:model-value="inputRule(index, 'tool_type', $event)"
					/></label>
				</div>
				<div class="guardrail-rule-decision">
					<label>Decision</label
					><UiSelect
						:model-value="item.decision"
						:disabled="disabled"
						:options="[
							{ value: 'allow', label: 'Allow' },
							{ value: 'deny', label: 'Deny' },
						]"
						style="width: 200px"
						@update:model-value="decision(index, $event)"
					/>
				</div>
				<div class="guardrail-rule-constraints">
					<UiButton
						v-if="!Object.keys(item.allowed_param_patterns ?? {}).length"
						:disabled="disabled"
						size="small"
						@click="rule(index, { allowed_param_patterns: { '': '' } })"
						>+ Restrict tool arguments (optional)</UiButton
					>
					<div v-else>
						<p>Argument constraints (dot or array paths)</p>
						<div
							v-for="([path, pattern], entryIndex) in Object.entries(item.allowed_param_patterns ?? {})"
							:key="entryIndex"
							class="guardrail-rule-constraint"
						>
							<UiInput
								:model-value="path"
								:disabled="disabled"
								placeholder="messages[0].content"
								@update:model-value="entry(index, entryIndex, 'key', $event)"
							/><UiInput
								:model-value="pattern"
								:disabled="disabled"
								placeholder="^email@.*$"
								@update:model-value="entry(index, entryIndex, 'value', $event)"
							/><UiButton
								:disabled="disabled"
								danger
								aria-label="Remove argument constraint"
								@click="entry(index, entryIndex, 'remove')"
								><template #icon><UiIcon name="DeleteOutlined" /></template
							></UiButton>
						</div>
						<UiButton
							size="small"
							:disabled="disabled"
							@click="rule(index, { allowed_param_patterns: { ...item.allowed_param_patterns, '': '' } })"
							>+ Add another constraint</UiButton
						>
					</div>
				</div></UiCard
			>
		</div>
		<hr />
		<div class="guardrail-rule-grid guardrail-rule-options">
			<label
				>Default action<UiSelect
					:model-value="value.default_action"
					:disabled="disabled"
					:options="[
						{ value: 'allow', label: 'Allow' },
						{ value: 'deny', label: 'Deny' },
					]"
					@update:model-value="select('default_action', $event)" /></label
			><label
				><span
					>On disallowed action<UiTooltip
						title="Block returns an error when a forbidden tool is invoked. Rewrite strips the tool call but lets the rest of the response continue."
						><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
				><UiSelect
					:model-value="value.on_disallowed_action"
					:disabled="disabled"
					:options="[
						{ value: 'block', label: 'Block' },
						{ value: 'rewrite', label: 'Rewrite' },
					]"
					@update:model-value="select('on_disallowed_action', $event)"
			/></label>
		</div>
		<label class="guardrail-rule-message"
			>Violation message (optional)<UiInput
				v-model="value.violation_message_template"
				multiline
				:rows="3"
				:disabled="disabled"
				placeholder="This violates our org policy..." /></label
	></UiCard>
</template>
