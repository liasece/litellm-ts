<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ModelAliasEditorForm from "./ModelAliasEditorFormComponent.vue";
import { familyOfModel, groupByModelFamily } from "../../providers/logic/ModelFamilyGrouping";
import ModelFamilyLabel from "../../providers/ui/ModelFamilyLabelComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { modelsApi } from "../api/ModelsApi";
import { modelRecord, type ModelCatalog } from "../support/ModelModels";
import { objectAlias, resolveAliasPath } from "../logic/AliasResolutionLogic";
import { aliasDraft, aliasDraftError, aliasDraftTargets, mergeAliasDraft, type ModelAliasDraft } from "../logic/ModelAliasDraftLogic";
import {
	getModelGroupAliasRecurse,
	validateModelGroupAliases,
	type ModelGroupAliases,
	type ModelGroupAliasValue,
} from "../logic/ModelGroupAliasLogic";
import notification from "../../notifications/logic/NotificationManager";
const props = defineProps<{ catalog: ModelCatalog }>();
interface Draft extends ModelAliasDraft {
	originalName: string | null;
	originalValue?: ModelGroupAliasValue;
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
/** 别名按品牌家族成组排布：认不出品牌的（自起名、裸名）排在最前，其余按家族名排序。 */
const aliasGroups = computed(() =>
	groupByModelFamily(
		Object.entries(aliases.value).map(([name, value]) => ({ name, value })),
		(entry) => familyOfModel(entry.name),
	),
);
const resolutions = computed(() =>
	Object.fromEntries(Object.keys(aliases.value).map((name) => [name, resolveAliasPath(name, aliases.value, names.value, now.value)])),
);
const scheduled = computed(() => Object.values(aliases.value).some((value) => objectAlias(value)?.schedule?.length));
const targetOptions = computed(() => {
	const values = new Set(modelOptions.value.map((option) => option.model_name));
	for (const [name, value] of Object.entries(aliases.value)) {
		values.add(name);
		const config = objectAlias(value);
		for (const target of config?.targets ??
			(config
				? [config.model, ...(config.schedule ?? []).map((window) => window.model)]
				: typeof value === "string"
					? [value]
					: (value as string[]))) {
			if (target) values.add(target);
		}
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
/** Declared targets in dispatch order, with blank editor rows removed. */
function aliasTargets(value: ModelGroupAliasValue | undefined): string[] {
	return aliasDraftTargets(value).filter((target) => target.trim().length > 0);
}
function open(name?: string) {
	const value = name === undefined ? undefined : aliases.value[name];
	formError.value = "";
	editor.value = { ...aliasDraft(name ?? "", value), originalName: name ?? null, originalValue: value };
}
/** 表单只认识草稿字段，编辑时保名的原始名字和值留在这层。 */
function updateDraft(next: ModelAliasDraft) {
	if (editor.value) editor.value = { ...editor.value, ...next };
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
	const blocking = aliasDraftError(draft, aliases.value, draft.originalName);
	if (blocking) {
		formError.value = blocking;
		return;
	}
	if (await save(mergeAliasDraft(aliases.value, draft, draft.originalName))) {
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
				<p>
					An alias dispatches to its first target; the remaining targets are tried only when the one above fails. Optional daily
					time windows replace the first target while they are active.
				</p>
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
					<template v-for="group in aliasGroups" :key="group.key">
						<tr class="model-family-band">
							<th colspan="4" scope="colgroup">
								<ModelFamilyLabel :family="group.family" :count="group.items.length" />
							</th>
						</tr>
						<tr
							v-for="{ name, value } in group.items"
							:key="name"
							:class="{ 'model-alias-unreachable': !resolutions[name].reachable }"
						>
							<td>
								<div class="model-inline">
									<ModelName :model="String(name)" :size="16" variant="strong" /><button
										class="model-icon-button"
										:aria-label="'Copy alias ' + name"
										@click="copy(name)"
									>
										<UiIcon name="CopyOutlined" />
									</button>
								</div>
							</td>
							<td>
								<div v-if="objectAlias(value)?.schedule?.length" class="model-alias-schedule-summary">
									<p>
										Default:
										<ModelName
											v-for="(target, index) in aliasTargets(value)"
											:key="index"
											class="model-alias-target"
											:model="target"
											:size="14"
											variant="code"
											><code>{{ (index ? " → " : "") + target }}</code></ModelName
										>
									</p>
									<strong>Daily · {{ objectAlias(value)?.timezone }}</strong>
									<p v-for="(window, index) in objectAlias(value)?.schedule" :key="index">
										<ModelName class="model-alias-target" :model="window.model" :size="14"
											><code
												>{{ window.start }}–{{ window.end }}{{ window.end < window.start ? " (+1 day)" : "" }} →
												{{ window.model }}</code
											></ModelName
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
										><ModelName class="model-alias-target" :model="node" :size="14"
											><code
												:class="
													index < resolutions[name].path.length - 2
														? 'model-alias-chain'
														: resolutions[name].reachable
															? ''
															: 'model-error'
												"
												>{{ node }}</code
											></ModelName
										></template
									>
								</div>
								<div v-if="aliasTargets(value).length > 1 || !getModelGroupAliasRecurse(value)" class="model-alias-then">
									<template v-if="aliasTargets(value).length > 1">
										<span class="model-alias-then-label">then</span>
										<span
											v-for="(target, index) in aliasTargets(value).slice(1)"
											:key="index"
											class="model-alias-then-item"
										>
											<span class="model-alias-then-index" aria-hidden="true">{{ index + 2 }}</span>
											<ModelName class="model-alias-target" :model="target" :size="14"
												><code>{{ target }}</code></ModelName
											>
										</span>
									</template>
									<UiTooltip
										v-if="!getModelGroupAliasRecurse(value)"
										title="A failed target stops here: its own fallback chain is not used."
									>
										<span class="model-alias-final"><UiHeroIcon name="BanIcon" :size="12" />No recursion</span>
									</UiTooltip>
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
					</template>
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
				<ModelAliasEditorForm :draft="editor" :target-options="targetOptions" :disabled="saving" @update:draft="updateDraft" />
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
