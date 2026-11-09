<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";

const props = defineProps<{ provider: string }>();
const emit = defineEmits<{ changed: [] }>();
const keyList = z.object({ data: z.array(z.object({ id: z.string(), label: z.string() })) });
const keys = ref<{ id: string; label: string }[]>([]);
const selected = ref(""),
	label = ref(""),
	secret = ref(""),
	error = ref(""),
	busy = ref(false);
const options = computed(() => [{ value: "", label: "New account" }, ...keys.value.map((k) => ({ value: k.id, label: k.label }))]);
let request: AbortController | undefined;
function select(id: string) {
	selected.value = id;
	label.value = keys.value.find((k) => k.id === id)?.label ?? "";
	secret.value = "";
}
async function load() {
	request?.abort();
	const current = new AbortController();
	request = current;
	select("");
	keys.value = [];
	error.value = "";
	busy.value = true;
	try {
		const result = await requestJson("/subscriptions/" + props.provider + "/keys", { signal: current.signal }, (v) => keyList.parse(v));
		if (!current.signal.aborted) keys.value = result.data;
	} catch (e) {
		if (!current.signal.aborted) error.value = e instanceof Error ? e.message : "Could not load accounts";
	} finally {
		if (request === current) busy.value = false;
	}
}
async function save() {
	if (busy.value || !label.value.trim() || (!selected.value && !secret.value.trim())) return;
	const current = new AbortController();
	request?.abort();
	request = current;
	busy.value = true;
	error.value = "";
	try {
		const result = await requestJson(
			"/subscriptions/" + props.provider + "/keys" + (selected.value ? "/" + encodeURIComponent(selected.value) : ""),
			{
				method: selected.value ? "PATCH" : "POST",
				signal: current.signal,
				body: JSON.stringify({ label: label.value.trim(), api_key: secret.value.trim() || undefined }),
			},
			(v) => keyList.parse(v),
		);
		if (!current.signal.aborted) {
			keys.value = result.data;
			select("");
			emit("changed");
		}
	} catch (e) {
		if (!current.signal.aborted) error.value = e instanceof Error ? e.message : "Could not save account";
	} finally {
		if (request === current) busy.value = false;
	}
}
watch(() => props.provider, load, { immediate: true });
onBeforeUnmount(() => {
	request?.abort();
	secret.value = "";
});
</script>
<template>
	<UiCard appearance="antd" size="small" title="Subscription API key" class="cp-card cp-card-small cp-mb-16">
		<form class="cp-inline cp-wrap cp-gap-8" @submit.prevent="save">
			<UiSelect
				:model-value="selected"
				:options="options"
				aria-label="Saved subscription account"
				:disabled="busy"
				@update:model-value="select(String($event ?? ''))"
			/>
			<UiInput v-model="label" aria-label="Account name" placeholder="Account name" :disabled="busy" />
			<UiInput
				v-model="secret"
				type="password"
				autocomplete="new-password"
				aria-label="Subscription API key"
				:placeholder="selected ? 'New API key (optional)' : 'API key'"
				:disabled="busy"
			/>
			<UiButton variant="primary" :loading="busy" :disabled="!label.trim() || (!selected && !secret.trim())" @click.prevent="save">{{
				selected ? "Save account" : "Add account"
			}}</UiButton>
		</form>
		<UiAlert v-if="error" type="error" :title="error" />
	</UiCard>
</template>
