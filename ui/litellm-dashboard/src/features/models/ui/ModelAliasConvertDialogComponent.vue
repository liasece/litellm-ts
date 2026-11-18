<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import ModelAliasEditorForm from "./ModelAliasEditorFormComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { deploymentIconProps } from "../logic/ModelDataLogic";
import { modelsApi } from "../api/ModelsApi";
import {
	aliasDraftError,
	aliasTargetNames,
	conversionAliasDraft,
	mergeAliasDraft,
	modelGroupDeploymentIds,
	type ModelAliasDraft,
} from "../logic/ModelAliasDraftLogic";
import { validateModelGroupAliases, type ModelGroupAliases } from "../logic/ModelGroupAliasLogic";
import { modelOptions, modelRecord, modelString, type DisplayProxyModel } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
/**
 * 把带 Model Override 的模型换成等价的别名。
 *
 * 顺序是先写别名、再删模型：别名的目标就是原来的 override 目标，所以中途失败时请求
 * 仍然落在同一个模型上，不会出现「模型已删、目标还没配上」的空窗。
 */
const props = defineProps<{ open: boolean; model: DisplayProxyModel | null }>();
const emit = defineEmits<{ close: []; converted: [aliases: ModelGroupAliases] }>();
const draft = ref<ModelAliasDraft>({ name: "", targets: [""], recurse: true, timezone: "Asia/Shanghai", schedule: [] }),
	aliases = ref<ModelGroupAliases>({}),
	modelNames = ref<string[]>([]),
	deployments = ref<string[]>([]),
	error = ref(""),
	loading = ref(false),
	saving = ref(false);
let generation = 0;
const targetOptions = computed(() => modelOptions(aliasTargetNames(modelNames.value, aliases.value)));
const overrideTarget = computed(() => modelString(props.model?.model_info.override_model_name));
const sameName = computed(() => draft.value.name.trim() === (props.model?.model_name ?? ""));
const blocking = computed(() => aliasDraftError(draft.value, aliases.value));
/** 保存失败的说明优先，其次是编辑中就能判定的问题，两者都写在同一个提示位。 */
const message = computed(
	() =>
		error.value ||
		blocking.value ||
		(!loading.value && !deployments.value.length
			? "This model has no removable deployment; delete it from the config file instead."
			: ""),
);
async function load(): Promise<void> {
	const current = ++generation;
	loading.value = true;
	error.value = "";
	draft.value = props.model === null ? draft.value : conversionAliasDraft(props.model);
	const name = props.model?.model_name ?? "";
	try {
		// 以线上为基准合并，避免覆盖别人刚保存的别名；目录里的副本可能已经过期。
		// 部署也从接口按名字取全，列表只显示当前页，不能用来判断这个公共名还剩几条。
		const [callbacks, models, page] = await Promise.all([
			modelsApi.fetchCallbacks(),
			modelsApi.fetchRoutableModels(),
			modelsApi.listModels({ page: 1, size: 200, search: name }),
		]);
		if (current !== generation) return;
		aliases.value = modelRecord(modelRecord(callbacks["router_settings"])["model_group_alias"]) as ModelGroupAliases;
		modelNames.value = models.map((option) => option.model_name);
		deployments.value = modelGroupDeploymentIds(page.data, name);
	} catch (reason) {
		if (current !== generation) return;
		error.value = reason instanceof Error ? reason.message : "Failed to load aliases";
	} finally {
		if (current === generation) loading.value = false;
	}
}
watch(
	() => [props.open, props.model] as const,
	() => {
		if (props.open && props.model) void load();
	},
	{ immediate: true },
);
async function convert(): Promise<void> {
	const model = props.model;
	if (!model || loading.value) return;
	const blockingError = blocking.value;
	if (blockingError) {
		error.value = blockingError;
		return;
	}
	if (!deployments.value.length) {
		error.value = "This model has no removable deployment; delete it from the config file instead.";
		return;
	}
	let updated: ModelGroupAliases;
	try {
		updated = mergeAliasDraft(aliases.value, draft.value);
		validateModelGroupAliases(updated);
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Invalid alias";
		return;
	}
	saving.value = true;
	error.value = "";
	try {
		await modelsApi.saveModelConfiguration({ router_settings: { model_group_alias: updated } });
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Failed to save the alias";
		saving.value = false;
		return;
	}
	const failed: string[] = [];
	for (const id of deployments.value) {
		try {
			await modelsApi.deleteModel(id);
		} catch {
			failed.push(id);
		}
	}
	saving.value = false;
	emit("converted", updated);
	if (failed.length) {
		notification.error(
			`Alias "${draft.value.name.trim()}" was saved, but ${failed.length} deployment(s) could not be deleted. Delete them from the list and try again.`,
		);
	} else {
		notification.success(`Converted "${model.model_name}" into an alias`);
	}
	emit("close");
}
</script>
<template>
	<UiDialog
		:open="open"
		title="Convert to alias"
		:width="720"
		scroll-mode="overlay"
		:mask-closable="!saving"
		@update:open="!$event && !saving && emit('close')"
	>
		<div class="model-alias-editor">
			<div class="model-alias-convert-summary">
				<div class="model-alias-convert-summary__row">
					<span>Model</span>
					<ModelName v-if="model" v-bind="deploymentIconProps(model)" :name="model.model_name" :size="16" variant="strong" />
				</div>
				<div class="model-alias-convert-summary__row">
					<span>Current override</span>
					<ModelName v-if="overrideTarget" :model="overrideTarget" :size="16" variant="strong" />
					<span v-else>—</span>
				</div>
				<p v-if="!loading" class="model-alias-convert-summary__note">
					Saving removes {{ deployments.length }} deployment(s) of “{{ model?.model_name }}” and replaces them with the alias
					below, which keeps sending requests to the same target. This cannot be undone.
				</p>
				<p v-if="!sameName" class="model-alias-convert-summary__note">
					The alias uses a different name, so clients asking for “{{ model?.model_name }}” will fail after the model is deleted.
				</p>
			</div>
			<ModelAliasEditorForm
				v-model:draft="draft"
				:target-options="targetOptions"
				:disabled="saving || loading"
				name-label="Alias name"
			/>
			<p v-if="message" role="alert" class="model-error">{{ message }}</p>
		</div>
		<template #footer>
			<div class="model-alias-editor-footer">
				<UiButton appearance="tremor" size="small" :disabled="saving" @click="emit('close')">Cancel</UiButton>
				<UiButton appearance="tremor" variant="primary" size="small" danger :loading="saving" :disabled="loading" @click="convert"
					>Convert to alias</UiButton
				>
			</div>
		</template>
	</UiDialog>
</template>

<style scoped>
.model-alias-convert-summary {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px;
	border: 1px solid #fde68a;
	border-radius: 10px;
	background: #fffbeb;
	font-size: 13px;
	line-height: 20px;
	color: #92400e;
}
.model-alias-convert-summary__row {
	display: flex;
	align-items: center;
	gap: 8px;
}
.model-alias-convert-summary__row > span:first-child {
	flex: none;
	min-width: 108px;
	color: #a16207;
}
.model-alias-convert-summary__note {
	margin: 0;
}
</style>
