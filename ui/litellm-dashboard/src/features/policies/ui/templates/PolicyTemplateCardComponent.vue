<script setup lang="ts">
import type { PolicyTemplate } from "../../support/PolicyModels";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
defineProps<{ template: PolicyTemplate }>();
defineEmits<{ use: [] }>();
const color = (name: string | undefined) => name?.replace("text-", "").replace("bg-", "") ?? "blue-600";
</script>
<template>
	<UiCard appearance="antd" class="policy-template-card"
		><header>
			<span class="policy-template-icon" :data-background="color(template.iconBg)"
				><PolicyHeroIconComponent
					:name="template.icon?.replace(/Icon$/, '') || 'ShieldCheck'"
					:size="24"
					:data-color="color(template.iconColor)" /></span
			><span class="policy-complexity" :class="'policy-complexity--' + template.complexity"
				>{{ template.complexity }} Complexity</span
			>
		</header>
		<h3>{{ template.title }}</h3>
		<p>{{ template.description }}</p>
		<div v-if="template.tags.length" class="policy-template-categories">
			<span v-for="tag in template.tags" :key="tag">{{ tag }}</span>
		</div>
		<div v-if="template.inherits" class="policy-template-inherits">
			Inherits from: <span>{{ template.inherits }}</span>
		</div>
		<div class="policy-template-guardrails">
			<strong>Included Guardrails</strong>
			<div>
				<span v-for="guardrail in template.guardrails" :key="guardrail">{{ guardrail }}</span>
			</div>
		</div>
		<UiButton variant="primary" @click="$emit('use')">Use Template</UiButton></UiCard
	>
</template>
