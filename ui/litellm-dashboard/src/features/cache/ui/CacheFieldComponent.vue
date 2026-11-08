<script setup lang="ts">
import { ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
import type { CacheField } from "../api/CacheApi";
const props = defineProps<{ field: CacheField; currentValue: unknown; models: { label: string; value: string }[] }>();
const identity = nextUiIdentity("cache-field"),
	value = ref(
		typeof props.currentValue === "object" && props.currentValue !== null
			? JSON.stringify(props.currentValue, null, 2)
			: props.currentValue == null
				? ""
				: String(props.currentValue),
	),
	checked = ref(props.currentValue === true || props.currentValue === "true");
</script>
<template>
	<div class="cache-field">
		<label :for="identity">{{ field.ui_field_name }}</label>
		<div v-if="field.field_type === 'Boolean'" class="cache-checkbox-row">
			<input :id="identity" v-model="checked" :name="field.field_name" type="checkbox" /><span>{{ field.field_description }}</span>
		</div>
		<template v-else-if="['Integer', 'Float'].includes(field.field_type)"
			><UiInputNumber
				:id="identity"
				:name="field.field_name"
				:model-value="value === '' ? null : Number(value)"
				appearance="tremor"
				:step="0.01"
				:placeholder="field.field_description"
				@update:model-value="value = $event == null ? '' : String($event)"
				@wheel="($event.target as HTMLInputElement).blur()"
			/>
			<p>{{ field.field_description }}</p></template
		><template v-else-if="field.field_type === 'List'">
			<textarea :id="identity" v-model="value" :name="field.field_name" :placeholder="field.field_description" rows="4" />
			<p>{{ field.field_description }}</p></template
		><template v-else-if="field.field_type === 'Models_Select'"
			><UiSelect :id="identity" v-model="value" :options="models" searchable placeholder="Search and select a model..." /><input
				type="hidden"
				:name="field.field_name"
				:value="value"
			/>
			<p v-if="field.field_description">{{ field.field_description }}</p></template
		><template v-else
			><UiInput
				:id="identity"
				v-model="value"
				:name="field.field_name"
				:type="field.field_name === 'password' || field.field_name.includes('password') ? 'password' : 'text'"
				appearance="tremor"
				:placeholder="field.field_description"
			/>
			<p v-if="field.field_description">{{ field.field_description }}</p></template
		>
	</div>
</template>
