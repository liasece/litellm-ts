<script setup lang="ts">
import { ref } from "vue";
import type { PlaygroundComplianceStore } from "../../stores/PlaygroundComplianceStore";
import { downloadComplianceTemplate } from "../../logic/PlaygroundCsvLogic";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
const props = defineProps<{ store: PlaygroundComplianceStore }>(),
	state = props.store.state,
	input = ref<HTMLInputElement>();
function upload(event: Event) {
	const file = (event.target as HTMLInputElement).files?.[0];
	if (file) void props.store.uploadCsv(file);
	(event.target as HTMLInputElement).value = "";
}
</script>
<template>
	<div v-if="state.showAdd" class="pg-compliance-dataset">
		<textarea v-model="state.newText" placeholder="Enter your test prompt..." rows="2" />
		<div class="pg-between pg-mt-8">
			<div class="pg-inline">
				<button
					type="button"
					class="pg-compliance-badge"
					:class="state.newExpected === 'fail' ? 'is-fail' : 'is-neutral'"
					@click="state.newExpected = 'fail'"
				>
					Should Fail</button
				><button
					type="button"
					class="pg-compliance-badge"
					:class="state.newExpected === 'pass' ? 'is-pass' : 'is-neutral'"
					@click="state.newExpected = 'pass'"
				>
					Should Pass
				</button>
			</div>
			<div class="pg-inline">
				<button
					type="button"
					@click="
						state.showAdd = false;
						state.newText = '';
					"
				>
					Cancel</button
				><button type="button" class="pg-compliance-primary" :disabled="!state.newText.trim()" @click="store.addPrompt">Add</button>
			</div>
		</div>
	</div>
	<div v-if="state.showCsv" class="pg-compliance-dataset">
		<div class="pg-between">
			<strong>Upload CSV Dataset</strong
			><button type="button" class="pg-blue" @click="downloadComplianceTemplate">
				<UiLucideIcon name="Download" :size="12" />Download Template
			</button>
		</div>
		<div class="pg-compliance-dataset__columns">
			<p><strong>Required columns:</strong> <code>prompt</code>, <code>expected_result</code> <span>(fail or pass)</span></p>
			<p><strong>Optional columns:</strong> <code>framework</code>, <code>category</code></p>
		</div>
		<input ref="input" type="file" accept=".csv" hidden @change="upload" /><button
			type="button"
			class="pg-compliance-dataset__upload"
			@click="input?.click()"
		>
			<UiLucideIcon name="Upload" :size="14" />Choose CSV file
		</button>
		<div v-if="state.csvError" class="pg-compliance-dataset__error">{{ state.csvError }}</div>
		<div class="pg-compliance-dataset__cancel">
			<button
				type="button"
				@click="
					state.showCsv = false;
					state.csvError = null;
				"
			>
				Cancel
			</button>
		</div>
	</div>
</template>
