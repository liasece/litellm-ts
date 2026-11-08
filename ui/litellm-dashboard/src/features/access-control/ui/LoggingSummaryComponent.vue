<script setup lang="ts">
import UiTag from "../../platform/ui/UiTag.vue";
import AccessHeroIconComponent from "./AccessHeroIconComponent.vue";
import { getCallbackById } from "../../virtual-keys/support/KeyCallbackSupport";
import { objectValue } from "../logic/ResourceDraftLogic";
defineProps<{ configs?: unknown; inline?: boolean }>();
function normalizedConfigs(value: unknown) {
	return Array.isArray(value) ? value.map(objectValue) : [];
}
</script>
<template>
	<section class="access-logging-summary" :class="{ 'access-logging-summary--inline': inline }">
		<header>
			<strong>Logging Settings</strong>
			<p v-if="!inline">Active logging integrations and disabled callbacks for this key</p>
		</header>
		<div class="access-logging-summary-section">
			<strong
				><AccessHeroIconComponent name="Cog" :size="16" />Logging Integrations
				<UiTag appearance="tremor" size="xs" color="blue">{{ normalizedConfigs($props.configs).length }}</UiTag></strong
			>
			<div v-for="(config, index) in normalizedConfigs($props.configs)" :key="index" class="access-logging-summary-row">
				<img
					v-if="getCallbackById(String(config.callback_name))?.logo"
					:src="getCallbackById(String(config.callback_name))?.logo"
					alt=""
				/>
				<div>
					<strong>{{ getCallbackById(String(config.callback_name))?.displayName || config.callback_name }}</strong
					><small>{{ Object.keys(objectValue(config.callback_vars)).length }} parameters configured</small>
				</div>
				<UiTag
					appearance="tremor"
					:color="config.callback_type === 'failure' ? 'red' : config.callback_type === 'success' ? 'green' : 'blue'"
					>{{
						config.callback_type === "success"
							? "Success Only"
							: config.callback_type === "failure"
								? "Failure Only"
								: config.callback_type === "success_and_failure"
									? "Success & Failure"
									: config.callback_type
					}}</UiTag
				>
			</div>
			<div v-if="!normalizedConfigs($props.configs).length" class="access-empty-logging">
				<AccessHeroIconComponent name="Cog" :size="16" />No logging integrations configured
			</div>
		</div>
		<div class="access-logging-summary-section">
			<strong
				><AccessHeroIconComponent name="Ban" :size="16" />Disabled Callbacks
				<UiTag appearance="tremor" size="xs" color="red">0</UiTag></strong
			>
			<div class="access-empty-logging"><AccessHeroIconComponent name="Ban" :size="16" />No callbacks disabled</div>
		</div>
	</section>
</template>
