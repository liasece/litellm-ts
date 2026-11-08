<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessModelOverflowComponent from "./AccessModelOverflowComponent.vue";
import type { AccessCatalog, AccessGroup, GroupDraft } from "../support/AccessModels";
const props = defineProps<{ open: boolean; group?: AccessGroup | null; catalog: AccessCatalog; pending?: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean]; submit: [values: GroupDraft] }>();
const tab = ref("general"),
	errors = ref<Record<string, string>>({});
const draft = reactive<GroupDraft>({ name: "", description: "", modelIds: [], mcpServerIds: [], agentIds: [] });
watch(
	() => props.open,
	(open) => {
		if (open) {
			Object.assign(draft, {
				name: props.group?.access_group_name ?? "",
				description: props.group?.description ?? "",
				modelIds: [...(props.group?.access_model_names ?? [])],
				mcpServerIds: [...(props.group?.access_mcp_server_ids ?? [])],
				agentIds: [...(props.group?.access_agent_ids ?? [])],
			});
			tab.value = "general";
			errors.value = {};
		}
	},
);
function submit() {
	errors.value = draft.name ? {} : { name: "Please enter the access group name" };
	if (Object.keys(errors.value).length) {
		tab.value = "general";
		return;
	}
	emit("submit", { ...draft });
}
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:open="open"
		:title="group ? 'Edit Access Group' : 'Create Access Group'"
		:width="700"
		:ok-text="group ? 'Save Changes' : 'Create Group'"
		:confirm-loading="pending"
		@update:open="emit('update:open', $event)"
		@ok="submit"
		><UiTabs
			v-model="tab"
			:items="[
				{ key: 'general', label: 'General Info' },
				{ key: 'models', label: 'Models' },
				{ key: 'mcp', label: 'MCP Servers' },
				{ key: 'agents', label: 'Agents' },
			]"
			><template #tab-general="{ item }"><UiLucideIcon name="InfoIcon" :size="16" />{{ item.label }}</template
			><template #tab-models="{ item }"><UiLucideIcon name="LayersIcon" :size="16" />{{ item.label }}</template
			><template #tab-mcp="{ item }"><UiLucideIcon name="ServerIcon" :size="16" />{{ item.label }}</template
			><template #tab-agents="{ item }"><UiLucideIcon name="BotIcon" :size="16" />{{ item.label }}</template></UiTabs
		>
		<form class="access-group-form" @submit.prevent="submit">
			<template v-if="tab === 'general'"
				><AccessFieldComponent
					v-model="draft.name"
					name="group-name"
					label="Group Name"
					required
					placeholder="e.g. Engineering Team"
					:error="errors.name" /><AccessFieldComponent
					v-model="draft.description"
					name="group-description"
					label="Description"
					type="textarea"
					placeholder="Describe the purpose of this access group..." /></template
			><AccessFieldComponent
				v-else-if="tab === 'models'"
				v-model="draft.modelIds"
				name="group-models"
				max-tag-count="responsive"
				label="Allowed Models"
				type="select"
				multiple
				:options="catalog.models"
				placeholder="Select Models"
				><template #overflow="{ options: omitted, count }"
					><AccessModelOverflowComponent :options="omitted" :count="count" /></template></AccessFieldComponent
			><AccessFieldComponent
				v-else-if="tab === 'mcp'"
				v-model="draft.mcpServerIds"
				name="group-mcp"
				label="Allowed MCP Servers"
				type="select"
				multiple
				:options="catalog.mcpServers"
				placeholder="Select MCP servers"
			/><AccessFieldComponent
				v-else
				v-model="draft.agentIds"
				name="group-agents"
				label="Allowed Agents"
				type="select"
				multiple
				:options="catalog.agents"
				placeholder="Select agents"
			/></form
	></UiDialog>
</template>
