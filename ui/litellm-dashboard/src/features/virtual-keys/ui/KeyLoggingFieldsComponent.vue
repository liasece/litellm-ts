<script setup lang="ts">
import { reactive } from "vue";
import "./styles/KeyLoggingForms.css";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import KeyHeroIcon from "./KeyHeroIconComponent.vue";
import { CALLBACK_CONFIGS, getCallbackById } from "../support/KeyCallbackSupport";
import { recordValue, selectedString, stringValues, type KeyDraft } from "../support/VirtualKeyModels";
const draft = defineModel<Pick<KeyDraft, "logging" | "disabled_callbacks">>({ required: true });
const supported = CALLBACK_CONFIGS.filter((callback) => callback.supports_key_team_logging).map((callback) => ({
	value: callback.id,
	label: callback.displayName,
}));
const all = CALLBACK_CONFIGS.map((callback) => ({ value: callback.id, label: callback.displayName }));
const brokenLogos = reactive(new Set<string>());
function add() {
	draft.value.logging = [...draft.value.logging, { callback_name: "", callback_type: "success", callback_vars: {} }];
}
function update(index: number, name: string, value: unknown) {
	draft.value.logging = draft.value.logging.map((config, position) =>
		position === index
			? { ...config, [name]: selectedString(value), ...(name === "callback_name" ? { callback_vars: {} } : {}) }
			: config,
	);
}
function parameter(index: number, name: string, value: unknown) {
	draft.value.logging = draft.value.logging.map((config, position) =>
		position === index ? { ...config, callback_vars: { ...recordValue(config.callback_vars), [name]: selectedString(value) } } : config,
	);
}
function logo(id: unknown) {
	return getCallbackById(selectedString(id))?.logo;
}
function display(id: unknown) {
	return getCallbackById(selectedString(id))?.displayName || "";
}
</script>
<template>
	<div class="vk-logging-fields">
		<section class="vk-disabled-logging">
			<h3>
				<KeyHeroIcon name="BanIcon" />Disabled Callbacks<UiTooltip
					title="Select callbacks to disable for this key. Disabled callbacks will not receive any logging data."
					><UiIcon name="InfoCircleOutlined" :size="14"
				/></UiTooltip>
			</h3>
			<div class="vk-disabled-logging-controls">
				<label>Disabled Callbacks</label
				><UiSelect
					:model-value="draft.disabled_callbacks"
					:options="all"
					multiple
					placeholder="Select callbacks to disable"
					@update:model-value="draft.disabled_callbacks = stringValues($event)"
					><template #option="{ option }"
						><UiTooltip :title="getCallbackById(String(option.value))?.description"
							><span class="vk-logging-option"
								><img
									v-if="logo(option.value) && !brokenLogos.has(String(option.value))"
									:src="logo(option.value)"
									:alt="option.label"
									@error="brokenLogos.add(String(option.value))"
								/><span v-else class="vk-logging-logo-fallback">{{ option.label.charAt(0) }}</span
								>{{ option.label }}</span
							></UiTooltip
						></template
					></UiSelect
				>
				<p>Select callbacks that should be disabled for this key. These callbacks will not receive any logging data.</p>
			</div>
		</section>
		<hr />
		<div class="vk-logging-heading">
			<h3>
				<KeyHeroIcon name="CogIcon" />Logging Integrations<UiTooltip title="Configure callback logging integrations for this team."
					><UiIcon name="InfoCircleOutlined" :size="14"
				/></UiTooltip>
			</h3>
			<UiButton appearance="tremor" @click="add"
				><template #icon><KeyHeroIcon name="PlusIcon" /></template>Add Integration</UiButton
			>
		</div>
		<div class="vk-logging-cards">
			<section v-for="(config, index) in draft.logging" :key="index" class="vk-logging-card">
				<header>
					<div>
						<img
							v-if="logo(config.callback_name)"
							:src="logo(config.callback_name)"
							:alt="display(config.callback_name)"
						/><span>{{ display(config.callback_name) || "New Integration" }} Configuration</span>
					</div>
					<UiButton
						appearance="tremor"
						variant="text"
						size="small"
						danger
						@click="draft.logging = draft.logging.filter((_, position) => position !== index)"
						><template #icon><KeyHeroIcon name="TrashIcon" /></template>Remove</UiButton
					>
				</header>
				<div class="vk-logging-grid">
					<label
						>Integration Type<UiSelect
							:model-value="config.callback_name || null"
							:options="supported"
							placeholder="Select integration"
							@update:model-value="update(index, 'callback_name', $event)"
							><template #option="{ option }"
								><UiTooltip :title="getCallbackById(String(option.value))?.description"
									><span class="vk-logging-option"
										><img
											v-if="logo(option.value) && !brokenLogos.has(String(option.value))"
											:src="logo(option.value)"
											:alt="option.label"
											@error="brokenLogos.add(String(option.value))"
										/><span v-else class="vk-logging-logo-fallback">{{ option.label.charAt(0) }}</span
										>{{ option.label }}</span
									></UiTooltip
								></template
							></UiSelect
						></label
					><label
						>Event Type<UiSelect
							:model-value="selectedString(config.callback_type) || 'success'"
							:options="[
								{ value: 'success', label: 'Success Only' },
								{ value: 'failure', label: 'Failure Only' },
								{ value: 'success_and_failure', label: 'Success & Failure' },
							]"
							@update:model-value="update(index, 'callback_type', $event)"
							><template #option="{ option }"
								><span class="vk-logging-event"
									><i :class="'vk-logging-event--' + option.value" />{{ option.label }}</span
								></template
							></UiSelect
						></label
					>
				</div>
				<div
					v-if="config.callback_name && Object.keys(getCallbackById(config.callback_name)?.dynamic_params || {}).length"
					class="vk-logging-parameters"
				>
					<h4><i />Integration Parameters</h4>
					<label v-for="(type, name) in getCallbackById(config.callback_name)?.dynamic_params" :key="name"
						><span
							>{{ String(name).replace(/_/g, " ")
							}}<UiTooltip :title="'Environment variable reference recommended: os.environ/' + String(name).toUpperCase()"
								><UiIcon name="InfoCircleOutlined" :size="12" /></UiTooltip
							><small v-if="type === 'password' || type === 'number'">{{
								type === "password" ? "Sensitive" : "Number"
							}}</small></span
						><small v-if="type === 'number'">Value must be between 0 and 1</small
						><UiInputNumber
							v-if="type === 'number'"
							:model-value="
								recordValue(config.callback_vars)[name] === '' || recordValue(config.callback_vars)[name] == null
									? null
									: Number(recordValue(config.callback_vars)[name])
							"
							:step="0.01"
							:placeholder="'os.environ/' + String(name).toUpperCase()"
							appearance="tremor"
							style="width: 400px; max-width: 100%"
							@update:model-value="parameter(index, String(name), $event)" /><UiInput
							v-else
							:model-value="selectedString(recordValue(config.callback_vars)[name])"
							:type="type === 'password' ? 'password' : 'text'"
							appearance="tremor"
							:placeholder="'os.environ/' + String(name).toUpperCase()"
							@update:model-value="parameter(index, String(name), $event)"
					/></label>
				</div>
			</section>
		</div>
		<div v-if="!draft.logging.length" class="vk-logging-empty">
			<KeyHeroIcon name="CogIcon" /><strong>No logging integrations configured</strong>
			<p>Click "Add Integration" to configure logging for this team</p>
		</div>
	</div>
</template>
