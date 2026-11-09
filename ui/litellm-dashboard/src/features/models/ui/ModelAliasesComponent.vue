<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { modelsApi } from "../api/ModelsApi";
import { modelRecord, type ModelCatalog } from "../support/ModelModels";
import { objectAlias, resolveAliasPath } from "../logic/AliasResolutionLogic";
import {
	validateModelGroupAliases,
	type ModelGroupAliases,
	type ModelGroupAliasValue,
	type ModelGroupAliasWindow,
} from "../logic/ModelGroupAliasLogic";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ catalog: ModelCatalog }>();
interface Draft {
	originalName: string | null;
	originalValue?: ModelGroupAliasValue;
	name: string;
	model: string;
	timezone: string;
	schedule: ModelGroupAliasWindow[];
}
interface Health {
	status: "none" | "checking" | "healthy" | "unhealthy";
	resolvedModel?: string;
	error?: string;
}
const aliases = ref<ModelGroupAliases>(modelRecord(props.catalog.router.model_group_alias) as ModelGroupAliases),
	editor = ref<Draft | null>(null),
	formError = ref(""),
	saving = ref(false),
	checking = ref(false),
	modelOptions = ref<{ model_name: string; type: string }[]>([]),
	health = ref<Record<string, Health>>({}),
	now = ref(new Date());
let disposed = false,
	timer: ReturnType<typeof setTimeout> | undefined;
const names = computed(() => new Set(modelOptions.value.filter((option) => option.type === "model").map((option) => option.model_name)));
const resolutions = computed(() =>
	Object.fromEntries(Object.keys(aliases.value).map((name) => [name, resolveAliasPath(name, aliases.value, names.value, now.value)])),
);
const scheduled = computed(() => Object.values(aliases.value).some((value) => objectAlias(value)?.schedule?.length));
const targets = computed(() => {
	const values = new Set(modelOptions.value.map((option) => option.model_name));
	for (const [name, value] of Object.entries(aliases.value)) {
		values.add(name);
		const config = objectAlias(value);
		for (const target of config
			? [config.model, ...(config.schedule ?? []).map((window) => window.model)]
			: typeof value === "string"
				? [value]
				: (value as string[]))
			values.add(target);
	}
	return [...values].sort().map((value) => ({ value, label: value }));
});
function checked(name: string): Health {
	const value = health.value[name] ?? { status: "none" },
		resolution = resolutions.value[name];
	const timed = resolution.path.some((node) => objectAlias(aliases.value[node])?.schedule?.length);
	return (value.resolvedModel && value.resolvedModel !== resolution.resolvedModel) || (timed && !value.resolvedModel)
		? { status: "none" }
		: value;
}
function open(name?: string) {
	const value = name === undefined ? undefined : aliases.value[name],
		config = objectAlias(value);
	formError.value = "";
	editor.value = {
		originalName: name ?? null,
		originalValue: value,
		name: name ?? "",
		model: config?.model ?? (typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : ""),
		timezone: config?.timezone ?? "Asia/Shanghai",
		schedule: config?.schedule?.map((window) => ({ ...window })) ?? [],
	};
}
function payload(draft: Draft): ModelGroupAliasValue {
	const model = draft.model.trim(),
		original = objectAlias(draft.originalValue);
	if (draft.schedule.length)
		return {
			...original,
			model,
			timezone: draft.timezone.trim(),
			schedule: draft.schedule.map((window) => ({ ...window, model: window.model.trim() })),
		};
	if (original) {
		const value = { ...original, model };
		delete value.schedule;
		delete value.timezone;
		return value;
	}
	return Array.isArray(draft.originalValue) ? [model, ...draft.originalValue.slice(1)] : model;
}
async function save(updated: ModelGroupAliases) {
	saving.value = true;
	try {
		validateModelGroupAliases(updated);
		await modelsApi.saveModelConfiguration({ router_settings: { model_group_alias: updated } });
		aliases.value = updated;
		health.value = {};
		now.value = new Date();
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to save aliases";
		formError.value = message;
		notification.error(message);
		return false;
	} finally {
		saving.value = false;
	}
}
async function saveEditor() {
	const draft = editor.value;
	if (!draft) return;
	const name = draft.name.trim();
	if (!name || !draft.model.trim()) {
		formError.value = "Alias name and default target are required";
		return;
	}
	if (name !== draft.originalName && Object.prototype.hasOwnProperty.call(aliases.value, name)) {
		formError.value = "An alias with this name already exists";
		return;
	}
	const updated = Object.fromEntries([
		...Object.entries(aliases.value).filter(([key]) => key !== draft.originalName),
		[name, payload(draft)],
	]);
	if (await save(updated)) {
		editor.value = null;
		notification.success(draft.originalName === null ? "Alias added" : "Alias updated");
	}
}
async function run(name: string) {
	const resolution = resolveAliasPath(name, aliases.value, names.value, new Date()),
		resolvedModel = resolution.resolvedModel;
	if (!resolution.reachable) {
		health.value[name] = { status: "unhealthy", resolvedModel, error: resolution.error };
		return;
	}
	health.value[name] = { status: "checking", resolvedModel };
	try {
		const response = await modelsApi.checkModelGroupHealth(name);
		if (disposed) return;
		const unhealthy = Number(response.unhealthy_count ?? 0) > 0,
			healthy = Number(response.healthy_count ?? 0) > 0;
		const endpoints = Array.isArray(response.unhealthy_endpoints) ? response.unhealthy_endpoints : [],
			failure = modelRecord(endpoints[0]).error;
		health.value[name] = {
			status: healthy && !unhealthy ? "healthy" : "unhealthy",
			resolvedModel,
			error: unhealthy
				? typeof failure === "string"
					? failure
					: "One or more target deployments failed"
				: healthy
					? undefined
					: "Health check returned no deployments",
		};
	} catch (error) {
		if (!disposed)
			health.value[name] = { status: "unhealthy", resolvedModel, error: error instanceof Error ? error.message : String(error) };
	}
}
async function all() {
	checking.value = true;
	try {
		await Promise.all(Object.keys(aliases.value).map(run));
	} finally {
		checking.value = false;
	}
}
function remove(name: string) {
	void save(Object.fromEntries(Object.entries(aliases.value).filter(([key]) => key !== name)));
}
function copy(name: string) {
	void copyText(name).catch(() => undefined);
}
function tick() {
	if (timer) clearTimeout(timer);
	now.value = new Date();
	if (scheduled.value) timer = setTimeout(tick, 60000 - (Date.now() % 60000));
}
function visibility() {
	if (document.visibilityState === "visible") tick();
}
watch(scheduled, tick);
onMounted(async () => {
	document.addEventListener("visibilitychange", visibility);
	tick();
	const results = await Promise.allSettled([modelsApi.fetchRoutableModels(), modelsApi.fetchLatestHealth()]);
	if (disposed) return;
	if (results[0].status === "fulfilled") modelOptions.value = results[0].value;
	else notification.error(results[0].reason instanceof Error ? results[0].reason.message : "Failed to load models");
	if (results[1].status === "fulfilled")
		for (const [key, value] of Object.entries(modelRecord(results[1].value.latest_health_checks))) {
			if (!key.startsWith("alias:")) continue;
			const record = modelRecord(value);
			health.value[key.slice(6)] = {
				status: record.status === "healthy" ? "healthy" : record.status === "unhealthy" ? "unhealthy" : "none",
				error: typeof record.error_message === "string" ? record.error_message : undefined,
			};
		}
});
onBeforeUnmount(() => {
	disposed = true;
	if (timer) clearTimeout(timer);
	document.removeEventListener("visibilitychange", visibility);
});
</script>
<template>
	<UiCard class="model-alias-card" :padding="16"
		><header class="model-alias-heading">
			<div>
				<h3>Model Group Aliases</h3>
				<p>Choose a default model and optional daily time windows. Requests outside those windows use the default target.</p>
			</div>
			<div class="model-inline">
				<UiButton appearance="tremor" size="small" :disabled="checking || !Object.keys(aliases).length || saving" @click="all"
					><template #icon><UiIcon :name="checking ? 'LoadingOutlined' : 'ReloadOutlined'" /></template>Check all</UiButton
				><UiButton appearance="tremor" size="small" variant="primary" :disabled="saving" @click="open()"
					><template #icon><UiIcon name="PlusOutlined" /></template>Add Alias</UiButton
				>
			</div>
		</header>
		<div class="model-alias-table model-table-overflow">
			<table class="model-simple-table">
				<thead>
					<tr>
						<th>Alias</th>
						<th>Resolution</th>
						<th>Health · current target</th>
						<th class="model-text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(value, name) in aliases" :key="name" :class="{ 'model-alias-unreachable': !resolutions[name].reachable }">
						<td>
							<div class="model-inline">
								<strong>{{ name }}</strong
								><button class="model-icon-button" :aria-label="'Copy alias ' + name" @click="copy(name)">
									<UiIcon name="CopyOutlined" />
								</button>
							</div>
						</td>
						<td>
							<div v-if="objectAlias(value)?.schedule?.length" class="model-alias-schedule-summary">
								<p>
									Default: <code>{{ objectAlias(value)?.model }}</code>
								</p>
								<strong>Daily · {{ objectAlias(value)?.timezone }}</strong>
								<p v-for="(window, index) in objectAlias(value)?.schedule" :key="index">
									<code
										>{{ window.start }}–{{ window.end }}{{ window.end < window.start ? " (+1 day)" : "" }} →
										{{ window.model }}</code
									>
								</p>
							</div>
							<div class="model-alias-resolution">
								<span
									v-if="resolutions[name].path.some((node) => objectAlias(aliases[node])?.schedule?.length)"
									class="model-muted"
									>Now:</span
								><template v-for="(node, index) in resolutions[name].path.slice(1)" :key="index"
									><span v-if="index">→</span
									><code
										:class="
											index < resolutions[name].path.length - 2
												? 'model-alias-chain'
												: resolutions[name].reachable
													? ''
													: 'model-error'
										"
										>{{ node }}</code
									></template
								>
							</div>
							<p v-if="resolutions[name].error" class="model-error model-small">{{ resolutions[name].error }}</p>
						</td>
						<td>
							<UiTooltip :title="checked(name).error ?? 'Checks the target selected at the time of the request'"
								><div class="model-inline">
									<UiTag
										appearance="tremor"
										size="xs"
										:color="
											checked(name).status === 'healthy'
												? 'emerald'
												: checked(name).status === 'unhealthy'
													? 'red'
													: checked(name).status === 'checking'
														? 'blue'
														: 'gray'
										"
										>{{ checked(name).status === "none" ? "not checked" : checked(name).status }}</UiTag
									><UiIcon
										v-if="checked(name).status === 'healthy' || checked(name).status === 'unhealthy'"
										:name="checked(name).status === 'healthy' ? 'CheckCircleOutlined' : 'CloseCircleOutlined'"
										:class="checked(name).status === 'healthy' ? 'model-success' : 'model-error'"
									/><button
										class="model-icon-button"
										:disabled="checked(name).status === 'checking' || saving"
										:aria-label="'Check health for ' + name"
										@click="run(name)"
									>
										<UiIcon :name="checked(name).status === 'checking' ? 'LoadingOutlined' : 'ReloadOutlined'" />
									</button></div
							></UiTooltip>
						</td>
						<td>
							<div class="model-alias-actions">
								<UiButton
									appearance="tremor"
									variant="text"
									size="small"
									:disabled="saving"
									:aria-label="'Edit alias ' + name"
									@click="open(name)"
									><template #icon><UiIcon name="EditOutlined" /></template></UiButton
								><UiButton
									appearance="tremor"
									variant="text"
									size="small"
									danger
									:disabled="saving"
									:aria-label="'Delete alias ' + name"
									@click="remove(name)"
									><template #icon><UiHeroIcon name="TrashIcon" /></template
								></UiButton>
							</div>
						</td>
					</tr>
					<tr v-if="!Object.keys(aliases).length">
						<td colspan="4" class="model-table-empty">No aliases configured</td>
					</tr>
				</tbody>
			</table>
		</div>
		<UiDialog
			:open="!!editor"
			:title="editor?.originalName === null ? 'Add Alias' : 'Edit Alias'"
			:width="760"
			scroll-mode="overlay"
			@update:open="!$event && !saving && (editor = null)"
			><div v-if="editor" class="model-alias-editor">
				<div class="model-alias-basics">
					<label>Alias name<UiInput id="alias-name" v-model="editor.name" :disabled="saving" /></label
					><label
						>Default target<UiSelect
							id="alias-default"
							:model-value="editor.model || null"
							@update:model-value="editor.model = typeof $event === 'string' ? $event : ''"
							:options="targets.filter((option) => option.value !== editor?.name.trim())"
							searchable
							aria-label="Resolution"
							placeholder="Select a model or alias"
							:disabled="saving"
					/></label>
				</div>
				<div class="model-alias-windows">
					<div class="model-inline model-between">
						<strong>Daily time windows</strong
						><UiButton
							appearance="tremor"
							size="small"
							:disabled="saving"
							@click="editor.schedule.push({ start: '', end: '', model: '' })"
							><template #icon><UiIcon name="PlusOutlined" /></template>Add time window</UiButton
						>
					</div>
					<p class="model-small model-muted model-alias-window-description">
						Start is included; end is excluded. An earlier end time continues into the next day. Windows cannot overlap.
					</p>
					<template v-if="editor.schedule.length"
						><label
							>Time zone<UiInput id="alias-timezone" v-model="editor.timezone" :disabled="saving" placeholder="Asia/Shanghai"
						/></label>
						<div v-for="(window, index) in editor.schedule" :key="index" class="model-alias-window">
							<label
								>Start<UiInput
									:id="'alias-start-' + index"
									v-model="window.start"
									type="time"
									:step="60"
									:aria-label="'Start time ' + (index + 1)"
									:disabled="saving" /></label
							><label
								>End<UiInput
									:id="'alias-end-' + index"
									v-model="window.end"
									type="time"
									:step="60"
									:aria-label="'End time ' + (index + 1)"
									:disabled="saving" /></label
							><label class="model-alias-window-target"
								>Target<UiSelect
									:id="'alias-target-' + index"
									:model-value="window.model || null"
									@update:model-value="window.model = typeof $event === 'string' ? $event : ''"
									:options="targets.filter((option) => option.value !== editor?.name.trim())"
									searchable
									:aria-label="'Time window target ' + (index + 1)"
									placeholder="Select a model or alias"
									:disabled="saving" /></label
							><UiButton
								appearance="tremor"
								variant="text"
								size="small"
								danger
								:disabled="saving"
								:aria-label="'Remove time window ' + (index + 1)"
								@click="editor.schedule.splice(index, 1)"
								><template #icon><UiHeroIcon name="TrashIcon" /></template
							></UiButton></div
					></template>
					<p v-else class="model-small model-muted">The default target is used all day.</p>
				</div>
				<p v-if="formError" role="alert" class="model-error">{{ formError }}</p>
			</div>
			<template #footer>
				<div class="model-alias-editor-footer">
					<UiButton appearance="tremor" size="small" :disabled="saving" @click="editor = null">Cancel</UiButton
					><UiButton appearance="tremor" variant="primary" size="small" :loading="saving" @click="saveEditor">Save</UiButton>
				</div>
			</template></UiDialog
		>
	</UiCard>
</template>
