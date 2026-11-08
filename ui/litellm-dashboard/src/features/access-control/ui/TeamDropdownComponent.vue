<script setup lang="ts">
import { watch, onBeforeUnmount } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { createTeamSelectionStore } from "../stores/TeamSelectionStore";
import type { AccessTeam } from "../support/AccessModels";
const props = withDefaults(
		defineProps<{
			modelValue?: string | null;
			value?: string;
			disabled?: boolean;
			organizationId?: string | null;
			pageSize?: number;
		}>(),
		{ modelValue: undefined, value: undefined, disabled: false, organizationId: undefined, pageSize: 20 },
	),
	emit = defineEmits<{ "update:modelValue": [value: string]; change: [value: string]; teamSelect: [team: AccessTeam | null] }>(),
	auth = useAuthenticationStore(),
	store = createTeamSelectionStore(() => ({
		authorized: auth.isAuthorized.value,
		userId: auth.state.session?.user_id,
		role: auth.userRole.value,
		organizationId: props.organizationId,
		pageSize: props.pageSize,
	}));
watch(
	() => [auth.isAuthorized.value, auth.state.session?.user_id, auth.userRole.value, props.organizationId, props.pageSize],
	() => void store.refresh(),
	{ immediate: true },
);
function choose(value: unknown) {
	const id = typeof value === "string" ? value : "";
	emit("update:modelValue", id);
	emit("change", id);
	emit("teamSelect", store.teams.value.find((team) => team.team_id === id) ?? null);
}
function scroll(event: Event) {
	const target = event.target as HTMLElement;
	if ((target.scrollTop + target.clientHeight) / target.scrollHeight >= 0.8) store.next();
}
function team(value: string | number) {
	return store.teams.value.find((row) => row.team_id === value);
}
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiSelect
		:model-value="modelValue ?? value"
		:disabled="disabled"
		:options="store.options.value"
		:loading="store.loading.value"
		placeholder="Search or select a team"
		searchable
		:filterable="false"
		clearable
		empty-text="No teams found"
		@search="store.queue"
		@popup-scroll="scroll"
		@update:model-value="choose"
		><template #option="{ option }"
			><span style="font-weight: 500">{{ team(option.value)?.team_alias }}</span>
			<span style="color: rgb(0 0 0 /0.45)">({{ option.value }})</span></template
		><template #value="{ option }"
			><template v-if="team(option.value)"
				><span style="font-weight: 500">{{ team(option.value)?.team_alias }}</span>
				<span style="color: rgb(0 0 0 /0.45)">({{ option.value }})</span></template
			><template v-else>{{ option.value }}</template></template
		><template #footer
			><div v-if="store.loadingNext.value" style="padding: 8px; text-align: center"><UiSpinner :size="14" /></div></template
	></UiSelect>
</template>
