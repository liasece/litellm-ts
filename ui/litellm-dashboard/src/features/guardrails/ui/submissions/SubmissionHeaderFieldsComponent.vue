<script setup lang="ts">
import { ref } from "vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import type { SubmittedGuardrail } from "../../support/GuardrailSubmissionModels";
import { addStaticHeader, addForwardHeader } from "../../logic/GuardrailSubmissionLogic";
const props = defineProps<{ row: SubmittedGuardrail }>(),
	emit = defineEmits<{ headers: [value: { key: string; value: string }[]]; extra: [value: string[]] }>(),
	key = ref(""),
	value = ref(""),
	extra = ref("");
function addStatic() {
	const next = addStaticHeader(props.row.customHeaders, key.value, value.value);
	if (next) {
		emit("headers", next);
		key.value = "";
		value.value = "";
	}
}
function addExtra() {
	const next = addForwardHeader(props.row.extraHeaders, extra.value);
	if (next) {
		emit("extra", next);
		extra.value = "";
	}
}
</script>
<template>
	<section class="submission-header-fields">
		<header>
			Static headers<span v-if="row.customHeaders.length">{{ row.customHeaders.length }}</span>
		</header>
		<p>Sent with every request to the guardrail.</p>
		<p v-if="!row.customHeaders.length" class="submission-empty-header">No static headers configured.</p>
		<ul v-else>
			<li v-for="(header, index) in row.customHeaders" :key="index">
				<span>{{ header.key }}: {{ header.value }}</span
				><button
					type="button"
					:aria-label="'Remove ' + header.key"
					@click="
						emit(
							'headers',
							row.customHeaders.filter((_, i) => i !== index),
						)
					"
				>
					<UiLucideIcon name="XIcon" :size="14" />
				</button>
			</li>
		</ul>
		<div class="submission-static-inputs">
			<input v-model="key" placeholder="Header name (e.g. X-API-Key)" @keydown.enter.prevent="addStatic" /><input
				v-model="value"
				placeholder="Value"
				@keydown.enter.prevent="addStatic"
			/><button type="button" @click="addStatic">Add</button>
		</div>
	</section>
	<section class="submission-header-fields">
		<header>
			Forward client headers<span v-if="row.extraHeaders.length">{{ row.extraHeaders.length }}</span>
		</header>
		<p>Allowed header names to forward from the client request to the guardrail (e.g. x-request-id).</p>
		<p v-if="!row.extraHeaders.length" class="submission-empty-header">No forward client headers configured.</p>
		<ul v-else>
			<li v-for="(name, index) in row.extraHeaders" :key="index">
				<span>{{ name }}</span
				><button
					type="button"
					:aria-label="'Remove ' + name"
					@click="
						emit(
							'extra',
							row.extraHeaders.filter((_, i) => i !== index),
						)
					"
				>
					<UiLucideIcon name="XIcon" :size="14" />
				</button>
			</li>
		</ul>
		<div class="submission-extra-inputs">
			<input v-model="extra" placeholder="e.g. x-request-id" @keydown.enter.prevent="addExtra" /><button
				type="button"
				@click="addExtra"
			>
				Add
			</button>
		</div>
	</section>
</template>
