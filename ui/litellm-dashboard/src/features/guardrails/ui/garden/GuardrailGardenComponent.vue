<script setup lang="ts">
import { ref, computed } from "vue";
import UiInput from "../../../platform/ui/UiInput.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import { ALL_CARDS, type GuardrailCardInfo } from "../../data/GuardrailGardenData";
import GuardrailGardenCardComponent from "./GuardrailGardenCardComponent.vue";
import GuardrailGardenDetailComponent from "./GuardrailGardenDetailComponent.vue";
const emit = defineEmits<{ created: [] }>(),
	search = ref(""),
	selected = ref<GuardrailCardInfo | null>(null),
	all = ref(false),
	filtered = computed(() =>
		ALL_CARDS.filter(
			(card) =>
				!search.value ||
				[card.name, card.description, ...card.tags].some((value) => value.toLowerCase().includes(search.value.toLowerCase())),
		),
	),
	litellm = computed(() => filtered.value.filter((card) => card.category === "litellm")),
	partners = computed(() => filtered.value.filter((card) => card.category === "partner"));
</script>
<template>
	<GuardrailGardenDetailComponent
		v-if="selected"
		:key="selected.id"
		:card="selected"
		@back="selected = null"
		@created="emit('created')"
	/>
	<div v-else class="guardrail-garden">
		<div class="guardrail-garden-search">
			<UiInput v-model="search" size="large" placeholder="Search guardrails"
				><template #prefix><UiIcon name="SearchOutlined" /></template
			></UiInput>
		</div>
		<section>
			<header>
				<h2>LiteLLM Content Filter</h2>
				<button type="button" @click="all = !all">
					<UiIcon v-if="!all" name="ArrowRightOutlined" :size="12" />{{ all ? "Show less" : "Show all (" + litellm.length + ")" }}
				</button>
			</header>
			<p>Built-in guardrails powered by LiteLLM. Zero latency, no external dependencies, no additional cost.</p>
			<div class="guardrail-garden-grid">
				<GuardrailGardenCardComponent
					v-for="card in all ? litellm : litellm.slice(0, 10)"
					:key="card.id"
					:card="card"
					@select="selected = card"
				/>
			</div>
		</section>
		<section>
			<h2>Partner Guardrails</h2>
			<p>Third-party guardrail integrations from leading AI security providers.</p>
			<div class="guardrail-garden-grid">
				<GuardrailGardenCardComponent v-for="card in partners" :key="card.id" :card="card" @select="selected = card" />
			</div>
		</section>
	</div>
</template>
