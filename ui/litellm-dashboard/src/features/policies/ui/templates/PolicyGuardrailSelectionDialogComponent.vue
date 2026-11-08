<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PolicyTemplate, GuardrailDefinition } from "../../support/PolicyModels";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import PolicyDividerComponent from "../common/PolicyDividerComponent.vue";
const props = defineProps<{
		open: boolean;
		template: PolicyTemplate | null;
		existing: Set<string>;
		loading: boolean;
		progress: { current: number; total: number } | null;
	}>(),
	emit = defineEmits<{ close: []; confirm: [definitions: GuardrailDefinition[]] }>();
const selected = ref(new Set<string>()),
	rows = computed(() => props.template?.guardrailDefinitions ?? []),
	fresh = computed(() => rows.value.filter((d) => !props.existing.has(d.guardrail_name))),
	existingCount = computed(() => rows.value.length - fresh.value.length);
watch(
	[() => props.open, () => props.template, () => props.existing],
	([open]) => {
		if (open) selected.value = new Set(fresh.value.map((d) => d.guardrail_name));
	},
	{ immediate: true },
);
function toggle(name: string) {
	const next = new Set(selected.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	selected.value = next;
}
</script>
<template>
	<UiDialog :open="open" :width="700" scroll-mode="overlay" class="policy-selection-dialog" @update:open="!$event && emit('close')"
		><template #title
			><h3>
				{{ template?.title }}<span v-if="progress">Template {{ progress.current }} of {{ progress.total }}</span>
			</h3>
			<p>Review and select guardrails to create for this template</p></template
		>
		<div class="policy-selection-body">
			<div class="policy-selection-summary">
				<UiIcon name="InfoCircleOutlined" :size="18" />
				<div>
					<strong>{{ rows.length }} total guardrails</strong><span>•</span><b>{{ fresh.length }} new</b
					><template v-if="existingCount"><span>•</span>{{ existingCount }} already exist</template>
				</div>
				<div v-if="fresh.length" class="policy-inline-actions">
					<UiButton size="small" @click="selected = new Set(fresh.map((d) => d.guardrail_name))">Select All New</UiButton
					><UiButton size="small" @click="selected = new Set()">Deselect All</UiButton>
				</div>
			</div>
			<div class="policy-selection-list">
				<article
					v-for="definition in rows"
					:key="definition.guardrail_name"
					:class="{ 'is-existing': existing.has(definition.guardrail_name) }"
				>
					<div>
						<UiIcon
							v-if="existing.has(definition.guardrail_name)"
							name="CheckCircleOutlined"
							:size="18"
							class="policy-success-text"
						/><UiCheckbox
							v-else
							:model-value="selected.has(definition.guardrail_name)"
							:label="definition.guardrail_name"
							@update:model-value="toggle(definition.guardrail_name)"
						/>
					</div>
					<section>
						<header>
							<strong>{{ definition.guardrail_name }}</strong
							><UiTag v-if="existing.has(definition.guardrail_name)" color="green">Already exists</UiTag>
						</header>
						<p>{{ definition.guardrail_info?.description || "No description available" }}</p>
						<div class="policy-selection-tags">
							<UiTag>{{ definition.litellm_params?.guardrail || "unknown" }}</UiTag
							><UiTag color="blue">{{
								Array.isArray(definition.litellm_params?.mode)
									? definition.litellm_params.mode.join(",")
									: definition.litellm_params?.mode || "unknown"
							}}</UiTag
							><UiTag v-if="definition.litellm_params?.patterns" color="purple"
								>{{ definition.litellm_params.patterns.length }} pattern(s)</UiTag
							><UiTag v-if="definition.litellm_params?.categories" color="orange"
								>{{ definition.litellm_params.categories.length }} category/categories</UiTag
							>
						</div>
					</section>
				</article>
			</div>
			<div v-if="!rows.length" class="policy-selection-empty">
				<p>No guardrails defined for this template.</p>
				<p>This template will use existing guardrails in your system.</p>
			</div>
			<template v-if="template?.discoveredCompetitors?.length"
				><PolicyDividerComponent />
				<div class="policy-selection-competitors">
					<header>
						<span>✨</span><strong>AI-Discovered Competitors ({{ template.discoveredCompetitors.length }})</strong>
					</header>
					<div>
						<UiTag v-for="name in template.discoveredCompetitors" :key="name" color="purple">{{ name }}</UiTag>
					</div>
					<p>These competitor names will be automatically blocked by the competitor-name-blocker guardrail.</p>
				</div></template
			>
			<PolicyDividerComponent />
			<p v-if="selected.size">
				<strong>{{ selected.size }}</strong> guardrail{{ selected.size > 1 ? "s" : "" }} will be created
			</p>
			<p v-else-if="existingCount" class="policy-success-text">All guardrails already exist. You can proceed to use this template.</p>
			<p v-else class="policy-warning-text">
				Select at least one guardrail to create, or click "Use Template" to proceed without creating new guardrails.
			</p>
		</div>
		<template #footer
			><UiButton :disabled="loading" @click="emit('close')">Cancel</UiButton
			><UiButton
				variant="primary"
				:loading="loading"
				:disabled="!selected.size && !existingCount"
				@click="
					emit(
						'confirm',
						rows.filter((d) => selected.has(d.guardrail_name)),
					)
				"
				>{{
					selected.size
						? "Create " + selected.size + " Guardrail" + (selected.size > 1 ? "s" : "") + " & Use Template"
						: "Use Template"
				}}</UiButton
			></template
		>
	</UiDialog>
</template>
