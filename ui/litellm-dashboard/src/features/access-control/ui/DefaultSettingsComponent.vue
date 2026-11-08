<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import AccessFieldComponent from "./AccessFieldComponent.vue";
import AccessModelOverflowComponent from "./AccessModelOverflowComponent.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import { accessApi } from "../api/AccessApi";
import { objectValue, stringList } from "../logic/ResourceDraftLogic";
import { budgetDurationOptions } from "../support/TeamFields";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import type { AccessCatalog, AccessRecord, ResourceOption } from "../support/AccessModels";
const props = defineProps<{ kind: "team" | "user"; catalog: AccessCatalog }>();
const money = useMoneyFormatter(),
	settings = ref<AccessRecord | null>(null),
	values = ref<AccessRecord>({}),
	draft = ref<AccessRecord>({}),
	loading = ref(true),
	editing = ref(false),
	pending = ref(false),
	error = ref(""),
	message = ref("");
const teamFields = [
	{
		name: "max_budget",
		label: "Max Budget",
		description: "Maximum budget (in USD) for new automatically created teams.",
		type: "number",
	},
	{ name: "budget_duration", label: "Budget Duration", description: "How frequently the team's budget resets.", type: "select" },
	{ name: "tpm_limit", label: "TPM Limit", description: "Maximum tokens per minute allowed across all models.", type: "number" },
	{ name: "rpm_limit", label: "RPM Limit", description: "Maximum requests per minute allowed across all models.", type: "number" },
	{ name: "models", label: "Models", description: "Default list of models that new teams can access.", type: "array" },
	{
		name: "team_member_permissions",
		label: "Team Member Permissions",
		description: "Default permissions granted to members of newly created teams. /key/info and /key/health are always included.",
		type: "array",
	},
];
const permissionOptions = [
	"/key/generate",
	"/key/update",
	"/key/delete",
	"/key/regenerate",
	"/key/service-account/generate",
	"/key/{key_id}/regenerate",
	"/key/block",
	"/key/unblock",
	"/key/bulk_update",
	"/key/{key_id}/reset_spend",
	"/key/info",
	"/key/list",
	"/key/aliases",
	"/team/daily/activity",
].map((value) => ({ value, label: value }));
const fields = computed(() =>
	props.kind === "team"
		? teamFields
		: Object.entries(objectValue(objectValue(settings.value?.field_schema).properties)).map(([name, value]) => {
				const field = objectValue(value);
				return {
					name,
					label: name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
					description: String(field.description || "No description available"),
					type: String(field.type ?? "string"),
				};
			}),
);
function options(name: string): ResourceOption[] {
	if (name === "models")
		return [
			{ value: "no-default-models", label: "No Default Models" },
			{ value: "all-proxy-models", label: "All Proxy Models" },
			...props.catalog.models,
		];
	if (name === "budget_duration") return budgetDurationOptions;
	if (name === "team_member_permissions") return permissionOptions;
	if (name === "user_role")
		return Object.entries(props.catalog.roles)
			.filter(([role]) => role.includes("internal_user"))
			.map(([value, role]) => ({ value, label: role.ui_label, description: role.description }));
	const field = objectValue(objectValue(objectValue(settings.value?.field_schema).properties)[name]);
	return stringList(field.enum ?? objectValue(field.items).enum).map((value) => ({ value, label: value }));
}
function type(name: string, valueType: string) {
	if (valueType === "boolean") return "switch";
	if (name === "models" || name === "budget_duration" || name === "user_role" || options(name).length) return "select";
	if (valueType === "number" || valueType === "integer") return "number";
	return "text";
}
function display(name: string, value: unknown) {
	if (value == null) return "Not set";
	if (name === "user_role") return props.catalog.roles[String(value)]?.ui_label ?? String(value);
	if (name === "budget_duration") return budgetDurationOptions.find((option) => option.value === value)?.label ?? String(value);
	if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
	if (name === "max_budget") return money(Number(value), 4);
	if (name === "tpm_limit" || name === "rpm_limit") return Number(value).toLocaleString("en-US");
	if (typeof value === "object") return JSON.stringify(value, null, 2);
	return String(value);
}
function teams(value: unknown) {
	return Array.isArray(value)
		? value.map((team) =>
				typeof team === "string"
					? { team_id: team, user_role: "user" }
					: { ...objectValue(team), team_id: objectValue(team).team_id ?? "", user_role: objectValue(team).user_role ?? "user" },
			)
		: [];
}
function updateTeam(index: number, name: string, value: unknown) {
	const list = teams(draft.value.teams);
	list[index] = { ...list[index], [name]: value };
	draft.value.teams = list;
}
function cloneValues() {
	return JSON.parse(JSON.stringify(values.value)) as AccessRecord;
}
async function save() {
	pending.value = true;
	error.value = "";
	try {
		const processed = Object.fromEntries(Object.entries(draft.value).map(([name, value]) => [name, value === "" ? null : value]));
		const response = objectValue(await accessApi.updateDefaults(props.kind, processed));
		values.value = objectValue(response.settings);
		draft.value = JSON.parse(JSON.stringify(values.value)) as AccessRecord;
		editing.value = false;
		message.value = props.kind === "team" ? "Default team settings updated successfully" : "Settings updated successfully";
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Failed to update settings";
	} finally {
		pending.value = false;
	}
}
onMounted(async () => {
	try {
		settings.value = await accessApi.defaults(props.kind);
		values.value = objectValue(settings.value.values);
		draft.value = JSON.parse(JSON.stringify(values.value)) as AccessRecord;
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Failed to fetch settings";
	} finally {
		loading.value = false;
	}
});
</script>
<template>
	<p v-if="loading" class="access-center">Loading...</p>
	<UiCard v-else :appearance="kind === 'team' ? 'antd' : 'tremor'" class="access-default-settings"
		><AccessNoticeComponent :error="error" :message="message" />
		<p v-if="!settings">
			{{
				kind === "team"
					? "No team settings available or you do not have permission to view them."
					: "No settings available or you do not have permission to view them."
			}}
		</p>
		<template v-else
			><header>
				<div>
					<h3>Default {{ kind === "team" ? "Team" : "User" }} Settings</h3>
					<p v-if="kind === 'team'">These settings will be applied by default when creating new teams.</p>
				</div>
				<div class="access-tags">
					<template v-if="editing"
						><UiButton
							:disabled="pending"
							@click="
								editing = false;
								draft = cloneValues();
							"
							>Cancel</UiButton
						><UiButton variant="primary" :loading="pending" @click="save"
							><template #icon><UiIcon name="SaveOutlined" :size="14" /></template>Save Changes</UiButton
						></template
					><UiButton v-else :variant="kind === 'team' ? 'default' : 'primary'" @click="editing = true"
						><template #icon><UiIcon name="EditOutlined" :size="14" /></template>Edit Settings</UiButton
					>
				</div>
			</header>
			<p v-if="objectValue(settings.field_schema).description">{{ objectValue(settings.field_schema).description }}</p>
			<hr />
			<template v-for="field in fields" :key="field.name"
				><div
					v-if="kind === 'team' && (field.name === 'max_budget' || field.name === 'models')"
					class="access-default-section-title"
				>
					{{ field.name === "max_budget" ? "Budget & Rate Limits" : "Access & Permissions" }}
				</div>
				<section class="access-default-row" :class="{ 'access-default-row--team': kind === 'team' }">
					<div>
						<strong>{{ field.label }}</strong>
						<p>{{ field.description }}</p>
					</div>
					<div>
						<template v-if="editing"
							><template v-if="field.name === 'teams'"
								><div v-for="(team, index) in teams(draft.teams)" :key="index" class="access-default-team">
									<header>
										<strong>Team {{ index + 1 }}</strong
										><UiButton
											size="small"
											danger
											@click="draft.teams = teams(draft.teams).filter((_, i) => i !== index)"
											>Remove</UiButton
										>
									</header>
									<div class="access-columns">
										<AccessFieldComponent
											:model-value="team.team_id"
											label="Team ID"
											placeholder="Enter team ID"
											@update:model-value="updateTeam(index, 'team_id', $event)"
										/><AccessFieldComponent
											:model-value="objectValue(team).max_budget_in_team"
											label="Max Budget in Team"
											type="number"
											:min="0"
											:step="0.01"
											placeholder="Optional"
											@update:model-value="updateTeam(index, 'max_budget_in_team', $event)"
										/><AccessFieldComponent
											:model-value="team.user_role"
											label="User Role"
											type="select"
											:options="[
												{ value: 'user', label: 'User' },
												{ value: 'admin', label: 'Admin' },
											]"
											@update:model-value="updateTeam(index, 'user_role', $event)"
										/>
									</div>
								</div>
								<UiButton block @click="draft.teams = [...teams(draft.teams), { team_id: '', user_role: 'user' }]"
									>＋ Add Team</UiButton
								></template
							><AccessFieldComponent
								v-else
								v-model="draft[field.name]"
								:name="'default-' + field.name"
								:max-tag-count="kind === 'team' && field.name === 'models' ? 'responsive' : undefined"
								:type="type(field.name, field.type)"
								:options="options(field.name)"
								:multiple="field.type === 'array' || field.name === 'models' || field.name === 'team_member_permissions'"
								:placeholder="field.type === 'number' ? 'Not set' : field.description"
								:class="{ 'access-default-input--limited': field.type === 'number' || field.name === 'budget_duration' }"
							>
								<template v-if="kind === 'team' && field.name === 'models'" #overflow="{ options: omitted, count }"
									><AccessModelOverflowComponent :options="omitted" :count="count"
								/></template> </AccessFieldComponent></template
						><template v-else
							><div v-if="Array.isArray(values[field.name]) && field.name !== 'teams'" class="access-tags">
								<UiTag v-for="value in stringList(values[field.name])" :key="value" color="blue">{{ value }}</UiTag
								><span v-if="!stringList(values[field.name]).length" class="access-muted">{{
									kind === "team" ? "Not set" : "None"
								}}</span>
							</div>
							<div v-else-if="field.name === 'teams'">
								<div v-for="(team, index) in teams(values.teams)" :key="index" class="access-default-team">
									<p>Team ID: {{ team.team_id || "Not specified" }}</p>
									<p>
										Max Budget:
										{{
											objectValue(team).max_budget_in_team !== undefined
												? money(Number(objectValue(team).max_budget_in_team), 4)
												: "No limit"
										}}
									</p>
									<p>Role: {{ team.user_role }}</p>
								</div>
								<span v-if="!teams(values.teams).length" class="access-muted">No teams assigned</span>
							</div>
							<span v-else :class="{ 'access-muted': values[field.name] == null }">{{
								display(field.name, values[field.name])
							}}</span></template
						>
					</div>
				</section></template
			>
			<p v-if="kind === 'user' && !fields.length">No schema information available</p></template
		></UiCard
	>
</template>
