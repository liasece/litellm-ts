<script setup lang="ts">
import { ref } from "vue";
import UiSelect from "../../src/features/platform/ui/UiSelect.vue";
import AccessFieldComponent from "../../src/features/access-control/ui/AccessFieldComponent.vue";
import AccessModelOverflowComponent from "../../src/features/access-control/ui/AccessModelOverflowComponent.vue";
import type { UiControlSize, UiValue } from "../../src/features/platform/ui/UiTypes";
const options = ref([
	{ value: "alpha", label: "Alpha model" },
	{ value: "beta", label: "Beta model" },
	{ value: "gamma", label: "Gamma model" },
	{ value: "delta", label: "Delta model" },
	{ value: "omega", label: "Omega model", disabled: true },
]);
const fixed = ref<UiValue[]>(["alpha", "beta", "gamma", "delta"]);
const responsive = ref<UiValue[]>(["alpha", "beta", "gamma", "delta"]);
const custom = ref<UiValue[]>(["alpha", "beta", "gamma", "delta"]);
const locked = ref<UiValue[]>(["alpha", "beta", "omega"]);
const single = ref<UiValue>("python");
const longModel = ref<UiValue[]>(["long-deployment"]);
const expanded = ref<UiValue[]>(["alpha", "beta", "gamma", "delta"]);
const longLabel = "A deployment with a substantially longer model name than the selector";
const access = ref<unknown>(["alpha", "beta", "gamma", "delta"]);
const accessChange = ref<unknown>(null);
const width = ref(280);
const limit = ref(2);
const fixedSize = ref<UiControlSize>("middle");
const disabled = ref(false);
function rename() {
	options.value = options.value.map((option) => ({ ...option, label: option.label + " with a substantially longer deployment name" }));
}
</script>
<template>
	<main style="padding: 24px">
		<label>Container width<input v-model.number="width" type="number" aria-label="Container width" /></label>
		<label>Fixed limit<input v-model.number="limit" type="number" aria-label="Fixed limit" /></label>
		<button type="button" @click="rename">Longer model labels</button>
		<button type="button" @click="disabled = !disabled">Toggle disabled</button>
		<button type="button" @click="fixedSize = 'small'">Small fixed tags</button>
		<button type="button" @click="fixedSize = 'large'">Large fixed tags</button>
		<section style="width: 700px; margin-top: 24px" data-testid="fixed">
			<UiSelect
				v-model="fixed"
				:options="options"
				:max-tag-count="limit"
				:size="fixedSize"
				multiple
				searchable
				aria-label="Fixed models"
			/>
			<output data-testid="fixed-values">{{ fixed.join(",") }}</output>
		</section>
		<section :style="{ width: width + 'px', marginTop: '24px' }" data-testid="responsive">
			<UiSelect
				v-model="responsive"
				:options="options"
				max-tag-count="responsive"
				multiple
				searchable
				clearable
				aria-label="Responsive models"
			/>
			<output data-testid="responsive-values">{{ responsive.join(",") }}</output>
		</section>
		<section :style="{ width: width + 'px', marginTop: '24px' }" data-testid="custom">
			<UiSelect
				v-model="custom"
				:options="options"
				max-tag-count="responsive"
				multiple
				searchable
				aria-label="Custom remainder models"
			>
				<template #overflow="{ count }">+{{ count }} more models</template>
			</UiSelect>
			<output data-testid="custom-values">{{ custom.join(",") }}</output>
		</section>
		<section style="width: 250px; margin-top: 24px" data-testid="locked">
			<UiSelect
				v-model="locked"
				:options="options"
				:max-tag-count="1"
				multiple
				searchable
				:disabled="disabled"
				aria-label="Locked models"
			/>
			<output data-testid="locked-values">{{ locked.join(",") }}</output>
		</section>
		<section :style="{ width: width + 'px', marginTop: '24px' }" data-testid="access">
			<AccessFieldComponent
				v-model="access"
				type="select"
				multiple
				max-tag-count="responsive"
				:options="options"
				label="Allowed models"
				name="access-models"
				@change="accessChange = $event"
			>
				<template #overflow="{ options: omitted, count }"
					><AccessModelOverflowComponent :options="omitted" :count="count"
				/></template>
			</AccessFieldComponent>
			<output data-testid="access-values">{{ JSON.stringify(access) }}</output
			><output data-testid="access-change">{{ JSON.stringify(accessChange) }}</output>
		</section>
		<section :style="{ width: width + 'px', marginTop: '24px' }" data-testid="expanded">
			<UiSelect
				v-model="expanded"
				:options="options"
				multiple
				searchable
				clearable
				placeholder="Select several model deployments"
				aria-label="Expanded models"
			/>
			<output data-testid="expanded-values">{{ expanded.join(",") }}</output>
		</section>
		<section style="width: 180px; margin-top: 24px" data-testid="long-model">
			<UiSelect
				v-model="longModel"
				:options="[{ value: 'long-deployment', label: longLabel }]"
				max-tag-count="responsive"
				multiple
				searchable
				aria-label="Long deployment"
			/>
			<output data-testid="long-values">{{ longModel.join(",") }}</output>
		</section>
		<section style="width: 180px; margin-top: 24px" data-testid="single">
			<UiSelect v-model="single" :options="[{ value: 'python', label: 'Python (OpenAI SDK)' }]" clearable aria-label="Language" />
		</section>
		<section style="width: 192px; margin-top: 24px; font-family: var(--ui-font-antd)" data-testid="tremor-natural">
			<UiSelect
				v-model="single"
				appearance="tremor"
				:options="[
					{ value: 'python', label: 'Python' },
					{ value: 'typescript', label: 'TypeScript' },
				]"
				aria-label="Natural Tremor language"
			/>
		</section>
		<section style="width: 404px; margin-top: 24px" data-testid="focused-credential">
			<UiSelect
				v-model="single"
				:options="[
					{ value: 'python', label: 'Python' },
					{ value: 'typescript', label: 'TypeScript' },
				]"
				searchable
				clearable
				placeholder="Search credentials"
				aria-label="Focused credential"
			/>
		</section>
	</main>
</template>
