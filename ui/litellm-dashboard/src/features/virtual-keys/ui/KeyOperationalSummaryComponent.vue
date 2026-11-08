<script setup lang="ts">
import KeyHeroIcon from "./KeyHeroIconComponent.vue";
import "./styles/KeyOperationalSummary.css";
import { computed } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { CALLBACK_CONFIGS } from "../support/KeyCallbackSupport";
import { recordValue, selectedString, stringValues, type VirtualKey } from "../support/VirtualKeyModels";
import { keyTimestamp } from "../render/KeyTablePresentation";
import KeyBadge from "./KeyBadgeComponent.vue";
const props = defineProps<{ keyData: VirtualKey; mode: "logging" | "rotation"; card?: boolean }>();
const logging = computed(() => (Array.isArray(props.keyData.metadata.logging) ? props.keyData.metadata.logging.map(recordValue) : []));
const callbacks = computed(() => stringValues(props.keyData.metadata.litellm_disabled_callbacks));
const hasRotation = computed(
	() => props.keyData.auto_rotate || props.keyData.last_rotation_at || props.keyData.key_rotation_at || props.keyData.next_rotation_at,
);
function callbackName(name: unknown) {
	return CALLBACK_CONFIGS.find((callback) => callback.id === name)?.displayName || selectedString(name);
}
function callbackLogo(name: unknown) {
	return CALLBACK_CONFIGS.find((callback) => callback.id === name)?.logo;
}
function eventLabel(value: unknown) {
	return (
		({ success: "Success Only", failure: "Failure Only", success_and_failure: "Success & Failure" } as Record<string, string>)[
			selectedString(value)
		] || selectedString(value)
	);
}
</script>
<template>
	<section class="vk-operational-summary" :class="{ 'vk-operational-summary--card': card }">
		<header>
			<h3>{{ mode === "logging" ? "Logging Settings" : "Auto-Rotation" }}</h3>
			<p v-if="card">
				{{
					mode === "logging"
						? "Active logging integrations and disabled callbacks for this key"
						: "Automatic key rotation settings and status for this key"
				}}
			</p>
		</header>
		<template v-if="mode === 'logging'"
			><section>
				<h4>
					<KeyHeroIcon name="CogIcon" />Logging Integrations<KeyBadge small>{{ logging.length }}</KeyBadge>
				</h4>
				<div v-if="logging.length" class="vk-summary-integrations">
					<div v-for="(config, index) in logging" :key="index" class="vk-summary-integration">
						<div>
							<img
								v-if="callbackLogo(config.callback_name)"
								:src="callbackLogo(config.callback_name)"
								:alt="callbackName(config.callback_name)"
							/><UiIcon v-else name="SettingOutlined" />
							<div>
								<strong>{{ callbackName(config.callback_name) }}</strong
								><small>{{ Object.keys(recordValue(config.callback_vars)).length }} parameters configured</small>
							</div>
						</div>
						<KeyBadge
							:color="config.callback_type === 'success' ? 'green' : config.callback_type === 'failure' ? 'red' : 'blue'"
							>{{ eventLabel(config.callback_type) }}</KeyBadge
						>
					</div>
				</div>
				<div v-else class="vk-summary-empty"><KeyHeroIcon name="CogIcon" />No logging integrations configured</div>
			</section>
			<section>
				<h4>
					<KeyHeroIcon name="BanIcon" />Disabled Callbacks<KeyBadge color="red" small>{{ callbacks.length }}</KeyBadge>
				</h4>
				<div v-if="callbacks.length" class="vk-summary-integrations">
					<div v-for="name in callbacks" :key="name" class="vk-summary-integration vk-summary-integration--disabled">
						<div>
							<img v-if="callbackLogo(name)" :src="callbackLogo(name)" :alt="callbackName(name)" /><UiIcon
								v-else
								name="StopOutlined"
							/>
							<div>
								<strong>{{ callbackName(name) }}</strong
								><small>Disabled for this key</small>
							</div>
						</div>
						<KeyBadge color="red">Disabled</KeyBadge>
					</div>
				</div>
				<div v-else class="vk-summary-empty"><KeyHeroIcon name="BanIcon" />No callbacks disabled</div>
			</section></template
		>
		<template v-else
			><section>
				<h4>
					<KeyHeroIcon name="RefreshIcon" />Auto-Rotation<KeyBadge :color="keyData.auto_rotate ? 'green' : 'gray'" small>{{
						keyData.auto_rotate ? "Enabled" : "Disabled"
					}}</KeyBadge
					><span v-if="keyData.auto_rotate && keyData.rotation_interval" class="vk-rotation-interval"
						>• Every {{ keyData.rotation_interval }}</span
					>
				</h4>
			</section>
			<section v-if="hasRotation">
				<div v-if="keyData.last_rotation_at" class="vk-rotation-record">
					<KeyHeroIcon name="ClockIcon" />
					<div>
						<strong>Last Rotation</strong>
						<p>{{ keyTimestamp(keyData.last_rotation_at) }}</p>
					</div>
				</div>
				<div v-if="keyData.key_rotation_at || keyData.next_rotation_at" class="vk-rotation-record">
					<KeyHeroIcon name="ClockIcon" />
					<div>
						<strong>Next Scheduled Rotation</strong>
						<p>{{ keyTimestamp(keyData.next_rotation_at || keyData.key_rotation_at) }}</p>
					</div>
				</div>
				<div
					v-if="keyData.auto_rotate && !keyData.last_rotation_at && !keyData.key_rotation_at && !keyData.next_rotation_at"
					class="vk-summary-empty"
				>
					<KeyHeroIcon name="ClockIcon" />No rotation history available
				</div>
			</section>
			<div v-else class="vk-summary-empty"><KeyHeroIcon name="RefreshIcon" />Auto-rotation is not enabled for this key</div></template
		>
	</section>
</template>
