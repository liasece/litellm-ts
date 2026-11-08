<script setup lang="ts">
import type { PlaygroundSettingsStore } from "../../stores/PlaygroundSettingsStore";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiInputNumber from "../../../platform/ui/UiInputNumber.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiPopover from "../../../platform/ui/UiPopover.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ settings: PlaygroundSettingsStore }>();
const config = props.settings.state;
function numeric(event: Event) {
	return Number((event.target as HTMLInputElement).value);
}
</script>
<template>
	<div class="pg-advanced">
		<UiCheckbox v-model="config.advancedParams"><strong>Use Advanced Parameters</strong></UiCheckbox>
		<div class="pg-inline">
			<UiCheckbox v-model="config.mockFallbacks"><strong>Simulate failure to test fallbacks</strong></UiCheckbox
			><UiPopover placement="right"
				><UiIcon name="InfoCircleOutlined" class="pg-muted" aria-label="Help: Simulate failure to test fallbacks" /><template
					#content
					><div style="max-width: 340px">
						<p>
							Causes the first request to fail so the router tries fallbacks (if configured). Use this to verify your fallback
							setup.
						</p>
						<p>
							Behavior can differ when keys, teams, or router settings are configured.
							<a
								href="https://docs.litellm.ai/docs/proxy/keys_teams_router_settings"
								target="_blank"
								rel="noopener noreferrer"
								>Learn more</a
							>
						</p>
					</div></template
				></UiPopover
			>
		</div>
		<div class="pg-advanced__parameters" :style="{ opacity: config.advancedParams ? 1 : 0.4 }">
			<div>
				<div class="pg-between pg-advanced__label">
					<span
						>Temperature
						<UiTooltip title="Controls randomness. Lower values make output more deterministic, higher values more creative."
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
					><UiInputNumber
						:model-value="config.temperature"
						:min="0"
						:max="2"
						:step="0.1"
						:precision="1"
						:disabled="!config.advancedParams"
						style="width: 80px"
						@update:model-value="config.temperature = $event ?? 1"
					/>
				</div>
				<input
					type="range"
					aria-label="Temperature"
					:value="config.temperature"
					min="0"
					max="2"
					step=".1"
					:disabled="!config.advancedParams"
					@input="config.temperature = numeric($event)"
				/>
				<div class="pg-range-marks"><span>0</span><span>1.0</span><span>2.0</span></div>
			</div>
			<div>
				<div class="pg-between pg-advanced__label">
					<span
						>Max Tokens
						<UiTooltip title="Maximum number of tokens to generate in the response."
							><UiIcon name="InfoCircleOutlined" /></UiTooltip></span
					><UiInputNumber
						:model-value="config.maxTokens"
						:min="1"
						:max="32768"
						:step="1"
						:disabled="!config.advancedParams"
						@update:model-value="config.maxTokens = $event ?? 1000"
					/>
				</div>
				<input
					type="range"
					aria-label="Max Tokens"
					:value="config.maxTokens"
					min="1"
					max="32768"
					step="1"
					:disabled="!config.advancedParams"
					@input="config.maxTokens = numeric($event)"
				/>
				<div class="pg-range-marks"><span>1</span><span>32768</span></div>
			</div>
		</div>
	</div>
</template>
