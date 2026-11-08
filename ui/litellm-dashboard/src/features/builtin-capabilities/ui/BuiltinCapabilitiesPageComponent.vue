<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiFormField from "../../platform/ui/UiFormField.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import ExecutorChainEditorComponent from "./ExecutorChainEditorComponent.vue";
import { createBuiltinCapabilitiesStore } from "../stores/BuiltinCapabilitiesStore";
import { capabilityPresentation } from "../data/CapabilityPresentation";
import type { CapabilityId } from "../support/BuiltinCapabilitiesModels";
import "./BuiltinCapabilitiesStyles.css";
const store = createBuiltinCapabilitiesStore(),
	state = store.state;
function models(id: CapabilityId) {
	const values =
		id === "vision"
			? state.data?.available_models
			: id === "web"
				? state.data?.web_available_models
				: state.data?.image_generation_available_models;
	return (values ?? []).map((row) => ({ value: row.model_name, label: row.model_name }));
}
onMounted(() => void store.initialize());
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="state.loading" class="builtin-loading"><UiSpinner /></div>
	<div v-else class="builtin-capabilities-page">
		<div class="builtin-page-heading">
			<h1>Built-in Capabilities</h1>
			<p>Manage private capabilities executed by LiteLLM. Models opt in separately from their model settings.</p>
		</div>
		<form class="builtin-cards" @submit.prevent="store.save">
			<UiCard v-for="card in capabilityPresentation" :key="card.id">
				<div class="builtin-card-heading">
					<div>
						<h2>{{ card.title }}</h2>
						<p>{{ card.description }}</p>
					</div>
					<div class="builtin-switch-control">
						<UiSwitch v-model="state.capabilities[card.id].enabled" :label="card.title"
							><span>{{ state.capabilities[card.id].enabled ? "On" : "Off" }}</span></UiSwitch
						>
					</div>
				</div>
				<UiAlert type="info" :title="card.notice" class="builtin-notice" />
				<UiFormField
					v-if="card.id === 'vision'"
					label="Always inject into context"
					help="Inject the private tool and instructions even when the current request has no image yet. Requests without image references are instructed not to call it."
					><div class="builtin-switch-control">
						<UiSwitch v-model="state.capabilities.vision.always_inject" label="Always inject into context"
							><span>{{ state.capabilities.vision.always_inject ? "On" : "Off" }}</span></UiSwitch
						>
					</div></UiFormField
				>
				<div class="builtin-chain-section" :class="{ 'builtin-chain-section--error': state.errors[card.id + '.executors'] }">
					<p class="builtin-chain-title">Execution chain</p>
					<p class="builtin-chain-help">
						{{
							card.id === "web"
								? "Tried in order. Model executors cover hosted search; DeepSeek Search & Fetch bypasses the model entirely."
								: "Tried in order. The first executor that succeeds answers the tool call."
						}}
					</p>
					<UiFormField :error="state.errors[card.id + '.executors']"
						><ExecutorChainEditorComponent
							v-model="state.capabilities[card.id].executors"
							:model-options="models(card.id)"
							:credential-options="state.credentials"
							:allow-deep-seek-tools="card.id === 'web'"
							:empty-hint="card.emptyHint"
					/></UiFormField>
				</div>
				<div class="builtin-settings-grid">
					<UiFormField label="Maximum private turns" required :error="state.errors[card.id + '.max_iterations']"
						><UiInputNumber
							v-model="state.capabilities[card.id].max_iterations"
							:min="1"
							:max="20"
							:aria-label="card.title + ' maximum private turns'"
					/></UiFormField>
					<UiFormField
						label="Worker output token limit"
						:required="card.id !== 'image_generation'"
						:error="state.errors[card.id + '.max_output_tokens']"
						><UiInputNumber
							v-model="state.capabilities[card.id].max_output_tokens"
							:min="128"
							:step="128"
							:aria-label="card.title + ' worker output token limit'"
					/></UiFormField>
					<UiFormField
						v-if="card.id === 'image_generation'"
						label="Allow creation without source image"
						help="Keep enabled to allow creating an image even when no source image is attached."
						><div class="builtin-switch-control">
							<UiSwitch
								v-model="state.capabilities.image_generation.always_inject"
								label="Allow creation without source image"
								><span>{{ state.capabilities.image_generation.always_inject ? "On" : "Off" }}</span></UiSwitch
							>
						</div></UiFormField
					>
				</div>
			</UiCard>
			<div class="builtin-save">
				<UiButton appearance="tremor" variant="primary" type="submit" :loading="state.saving">Save Changes</UiButton>
			</div>
		</form>
	</div>
</template>
