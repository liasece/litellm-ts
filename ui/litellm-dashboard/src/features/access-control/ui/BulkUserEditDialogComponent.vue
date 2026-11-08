<script setup lang="ts">
import { ref, watch } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import UserEditFieldsComponent from "./UserEditFieldsComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { AccessCatalog, AccessRecord, AccessUser } from "../support/AccessModels";
const props = defineProps<{
		open: boolean;
		users: AccessUser[];
		catalog: AccessCatalog;
		role: string;
		pending?: boolean;
		allowAll?: boolean;
	}>(),
	emit = defineEmits<{
		"update:open": [value: boolean];
		submit: [value: AccessRecord, teamIds: string[], budget: number | null, all: boolean];
	}>();
const all = ref(false),
	addToTeams = ref(false),
	teams = ref<string[]>([]),
	budget = ref<number | null>(null),
	money = useMoneyFormatter();
watch(
	() => props.open,
	(open) => {
		if (open) {
			all.value = false;
			addToTeams.value = false;
			teams.value = [];
			budget.value = null;
		}
	},
);
const columns = [
	{ key: "user_id", label: "User ID", width: "30%" },
	{ key: "user_email", label: "Email", width: "25%" },
	{ key: "user_role", label: "Current Role", width: "25%" },
	{ key: "max_budget", label: "Budget", width: "20%" },
];
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		class="access-bulk-user-edit-dialog"
		:open="open"
		:title="all ? 'Bulk Edit All Users' : 'Bulk Edit ' + users.length + ' User(s)'"
		:width="800"
		:show-footer="false"
		@update:open="emit('update:open', $event)"
		><div v-if="allowAll" class="access-bulk-all">
			<UiCheckbox v-model="all" label="Update ALL users in the system"><strong>Update ALL users in the system</strong></UiCheckbox>
			<p v-if="all" class="access-warning">⚠️ This will apply changes to ALL users in the system, not just the selected ones.</p>
		</div>
		<section v-if="!all" class="access-bulk-selected-users">
			<h5>Selected Users ({{ users.length }}):</h5>
			<UiTable :rows="users" :columns="columns" row-key="user_id" compact
				><template #cell-user_id="{ value }"
					><strong>{{ String(value).length > 20 ? String(value).slice(0, 20) + "..." : value }}</strong></template
				><template #cell-user_email="{ value }">{{ value || "No email" }}</template
				><template #cell-user_role="{ value }">{{ catalog.roles[String(value)]?.ui_label || value }}</template
				><template #cell-max_budget="{ value }">{{ value != null ? money(Number(value), 4) : "Unlimited" }}</template></UiTable
			>
		</section>
		<hr />
		<p class="access-bulk-instructions">
			<strong>Instructions:</strong> Fill in the fields below with the values you want to apply to all selected users. You can bulk
			edit: role, budget, models, and metadata. You can also add users to teams.
		</p>
		<UiCard appearance="antd" title="Team Management" size="small" class="access-bulk-team-management"
			><UiCheckbox v-model="addToTeams" label="Add selected users to teams">Add selected users to teams</UiCheckbox
			><template v-if="addToTeams"
				><AccessFieldComponent
					v-model="teams"
					name="bulk-edit-teams"
					label="Select Teams:"
					type="select"
					multiple
					:options="catalog.teams.map((team) => ({ value: team.team_id, label: team.team_alias || team.team_id }))"
					placeholder="Select teams to add users to"
				/><AccessFieldComponent
					v-model="budget"
					name="bulk-edit-team-budget"
					label="Team Budget (Optional):"
					type="number"
					:min="0"
					:step="0.01"
					placeholder="Max budget per user in team"
					help="Leave empty for unlimited budget within team limits"
				/>
				<p class="access-muted">
					Users will be added with &quot;user&quot; role by default. All users will be added to each selected team.
				</p></template
			></UiCard
		><UserEditFieldsComponent
			:catalog="catalog"
			:role="role"
			bulk
			:pending="pending"
			@cancel="emit('update:open', false)"
			@submit="emit('submit', $event, addToTeams ? teams : [], budget, all)"
		/>
		<p v-if="pending" class="access-center">Updating {{ all ? "all users" : users.length }} user(s)...</p></UiDialog
	>
</template>
