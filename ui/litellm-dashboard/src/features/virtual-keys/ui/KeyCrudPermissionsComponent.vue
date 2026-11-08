<script setup lang="ts">
import { computed, reactive } from "vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import { CRUD_GROUP_META, groupToolsByCrud, type CrudOp, type MCPToolEntry } from "../logic/McpToolCrudLogic";
const props = defineProps<{ tools: MCPToolEntry[]; modelValue?: string[]; disabled?: boolean; searchFilter?: string }>();
const emit = defineEmits<{ "update:modelValue": [allowed: string[]] }>();
const order: CrudOp[] = ["read", "create", "update", "delete", "unknown"];
const collapsed = reactive<Record<CrudOp, boolean>>({ read: false, create: false, update: false, delete: false, unknown: true });
const groups = computed(() => groupToolsByCrud(props.tools));
const visibleGroups = computed(() => {
	const search = (props.searchFilter ?? "").toLowerCase();
	return Object.fromEntries(
		order.map((op) => [
			op,
			groups.value[op].filter(
				(tool) => !search || tool.name.toLowerCase().includes(search) || (tool.description ?? "").toLowerCase().includes(search),
			),
		]),
	) as Record<CrudOp, MCPToolEntry[]>;
});
const allowed = computed(() => new Set(props.modelValue ?? props.tools.map((tool) => tool.name)));
function all(op: CrudOp) {
	return groups.value[op].length > 0 && groups.value[op].every((tool) => allowed.value.has(tool.name));
}
function partial(op: CrudOp) {
	const count = groups.value[op].filter((tool) => allowed.value.has(tool.name)).length;
	return count > 0 && count < groups.value[op].length;
}
function toggle(name: string) {
	if (props.disabled) return;
	const next = new Set(allowed.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	emit("update:modelValue", [...next]);
}
function toggleGroup(op: CrudOp, enabled: boolean) {
	if (props.disabled) return;
	const next = new Set(allowed.value);
	for (const tool of groups.value[op]) {
		if (enabled) next.add(tool.name);
		else next.delete(tool.name);
	}
	emit("update:modelValue", [...next]);
}
</script>
<template>
	<div class="vk-crud-groups">
		<template v-for="op in order" :key="op"
			><section v-if="visibleGroups[op].length" class="vk-crud-group" :class="'vk-crud-group--' + op">
				<header>
					<button type="button" class="vk-crud-collapse" :aria-expanded="!collapsed[op]" @click="collapsed[op] = !collapsed[op]">
						<svg viewBox="0 0 24 24">
							<path
								:d="collapsed[op] ? 'm9 6 6 6-6 6' : 'm6 9 6 6 6-6'"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						><strong>{{ CRUD_GROUP_META[op].label }}</strong
						><span class="vk-risk-badge" :class="'vk-risk-badge--' + CRUD_GROUP_META[op].risk">{{
							CRUD_GROUP_META[op].risk === "high"
								? "High Risk"
								: CRUD_GROUP_META[op].risk === "medium"
									? "Medium Risk"
									: CRUD_GROUP_META[op].risk === "low"
										? "Safe"
										: "Unclassified"
						}}</span
						><small>{{ groups[op].filter((tool) => allowed.has(tool.name)).length }}/{{ groups[op].length }} allowed</small>
					</button>
					<div v-if="!disabled" class="vk-crud-group-toggle">
						<span>{{ all(op) ? "All on" : partial(op) ? "Partial" : "All off" }}</span
						><UiCheckbox
							:model-value="all(op)"
							:indeterminate="partial(op)"
							:label="'Allow all ' + op + ' tools'"
							@update:model-value="toggleGroup(op, $event)"
						/>
					</div>
				</header>
				<template v-if="!collapsed[op]"
					><p class="vk-crud-description">{{ CRUD_GROUP_META[op].description }}</p>
					<div
						v-for="tool in visibleGroups[op]"
						:key="tool.name"
						class="vk-crud-tool"
						:class="{ 'vk-crud-tool--off': !allowed.has(tool.name) }"
						@click="toggle(tool.name)"
					>
						<UiCheckbox
							:model-value="allowed.has(tool.name)"
							:disabled="disabled"
							:label="tool.name"
							@click.stop
							@update:model-value="toggle(tool.name)"
						/>
						<div>
							<strong>{{ tool.name }}</strong>
							<p v-if="tool.description">{{ tool.description }}</p>
						</div>
						<span class="vk-tool-enabled" :class="{ 'vk-tool-enabled--on': allowed.has(tool.name) }">{{
							allowed.has(tool.name) ? "on" : "off"
						}}</span>
					</div></template
				>
			</section></template
		>
	</div>
</template>
