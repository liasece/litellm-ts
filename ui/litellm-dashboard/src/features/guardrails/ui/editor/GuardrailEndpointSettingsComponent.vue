<script setup lang="ts">
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import type { GuardrailEndpointDraft } from "../../logic/GuardrailCreateLogic";
const value = defineModel<GuardrailEndpointDraft>({ required: true });
function type(input: unknown) {
	value.value.type = typeof input === "string" ? input : "";
	value.value.open = false;
}
function violations(event: Event) {
	const text = (event.target as HTMLInputElement).value;
	value.value.endSessionAfterNFails = text ? parseInt(text, 10) : undefined;
}
</script>
<template>
	<div class="guardrail-endpoint-settings">
		<p>
			Configure settings for a specific call type. Most guardrails don't need this — skip it unless you're using a specific endpoint
			like <code>/v1/realtime</code>.
		</p>
		<div>
			<label>Call type</label
			><UiSelect
				:model-value="value.type || null"
				:options="[{ value: 'realtime', label: '/v1/realtime' }]"
				placeholder="Select a call type"
				clearable
				style="width: 260px"
				@update:model-value="type"
			/><small>More call types coming soon.</small>
		</div>
		<div v-if="value.type === 'realtime'" class="guardrail-realtime-settings">
			<button type="button" @click="value.open = !value.open">
				<span>/v1/realtime settings</span><UiIcon name="DownOutlined" :class="{ open: value.open }" :size="16" />
			</button>
			<div v-if="value.open">
				<div>
					<label>End session after X violations</label
					><small>Automatically close the session after this many guardrail violations. Leave empty to never auto-close.</small
					><input type="number" :min="1" placeholder="e.g. 3" :value="value.endSessionAfterNFails ?? ''" @input="violations" />
				</div>
				<div>
					<label>On violation</label
					><label v-for="option in ['warn', 'end_session']" :key="option" class="guardrail-violation-radio"
						><input v-model="value.onViolation" type="radio" name="on_violation" :value="option" />
						<div>
							<strong>{{ option === "warn" ? "Warn" : "End session" }}</strong>
							<p>
								{{
									option === "warn"
										? "Bot speaks the message, session continues"
										: "Bot speaks the message, connection closes immediately"
								}}
							</p>
						</div></label
					>
				</div>
				<div>
					<label>Message the user hears</label
					><small>What the bot says aloud when this guardrail fires. Falls back to the default violation message if empty.</small
					><textarea
						v-model="value.message"
						:rows="3"
						placeholder="e.g. I'm not able to continue this conversation. Please contact us at 1-800-774-2678."
					/>
				</div>
			</div>
		</div>
	</div>
</template>
