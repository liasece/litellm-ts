<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import TagFieldsComponent from "./TagFieldsComponent.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { tagsApi, tagEditModels } from "../api/TagsApi";
import type { TagModelOption, ToolTag } from "../support/TagModels";
const props = defineProps<{ name: string; edit?: boolean; admin: boolean }>(),
	emit = defineEmits<{ back: []; changed: [] }>();
const data = ref<ToolTag | null>(null),
	editing = ref(Boolean(props.edit)),
	models = ref<TagModelOption[]>([]),
	draft = ref<Record<string, unknown>>({}),
	error = ref(""),
	message = ref(""),
	pending = ref(false),
	copied = ref(false),
	money = useMoneyFormatter();
let generation = 0;
async function refresh() {
	const current = ++generation;
	try {
		const result = await tagsApi.detail(props.name);
		if (current !== generation) return;
		data.value = result;
		draft.value = {
			...result,
			...(props.edit
				? { max_budget: result.litellm_budget_table?.max_budget, budget_duration: result.litellm_budget_table?.budget_duration }
				: {}),
		};
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Error fetching tag details";
	}
}
async function save() {
	if (!draft.value.name) {
		error.value = "Please input a tag name";
		return;
	}
	pending.value = true;
	try {
		await tagsApi.update({
			name: draft.value.name,
			description: draft.value.description,
			models: draft.value.models,
			max_budget: draft.value.max_budget,
			tpm_limit: draft.value.tpm_limit,
			rpm_limit: draft.value.rpm_limit,
			budget_duration: draft.value.budget_duration,
		});
		message.value = "Tag updated successfully";
		editing.value = false;
		await refresh();
		emit("changed");
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Error updating tag";
	} finally {
		pending.value = false;
	}
}
async function copy() {
	if (data.value) {
		await navigator.clipboard.writeText(data.value.name);
		copied.value = true;
		setTimeout(() => {
			copied.value = false;
		}, 2000);
	}
}
onMounted(() => {
	void refresh();
	void tagEditModels()
		.then((value) => {
			models.value = value;
		})
		.catch(() => {});
});
onBeforeUnmount(() => {
	++generation;
});
</script>
<template>
	<section class="tools-tag-detail">
		<AccessNoticeComponent :error="error" :message="message" />
		<div v-if="!data">Loading...</div>
		<template v-else
			><header>
				<div>
					<UiButton appearance="tremor" variant="primary" @click="emit('back')">← Back to Tags</UiButton>
					<div class="tools-tag-detail-name">
						<span>Tag Name:</span><code>{{ data.name }}</code
						><UiButton variant="text" size="small" aria-label="Copy tag name" @click="copy"
							><template #icon><UiLucideIcon :name="copied ? 'Check' : 'Copy'" :size="12" /></template
						></UiButton>
					</div>
					<p>{{ data.description || "No description" }}</p>
				</div>
				<UiButton v-if="admin && !editing" appearance="tremor" variant="primary" @click="editing = true">Edit Tag</UiButton>
			</header>
			<UiCard v-if="editing"
				><TagFieldsComponent
					v-model="draft"
					:models="models"
					:error="error"
					:pending="pending"
					@cancel="editing = false"
					@submit="save"
			/></UiCard>
			<div v-else class="tools-tag-details-cards">
				<UiCard
					><h3>Tag Details</h3>
					<dl>
						<dt>Name</dt>
						<dd>{{ data.name }}</dd>
						<dt>Description</dt>
						<dd>{{ data.description || "-" }}</dd>
						<dt>Allowed Models</dt>
						<dd>
							<div class="tools-tags">
								<UiTag v-if="!data.models.length" appearance="tremor" color="red">All Models</UiTag
								><UiTooltip v-for="model in data.models" :key="model" :title="'ID: ' + model"
									><UiTag appearance="tremor" color="blue">{{ data.model_info?.[model] || model }}</UiTag></UiTooltip
								>
							</div>
						</dd>
						<dt>Created</dt>
						<dd>{{ data.created_at ? new Date(data.created_at).toLocaleString() : "-" }}</dd>
						<dt>Last Updated</dt>
						<dd>{{ data.updated_at ? new Date(data.updated_at).toLocaleString() : "-" }}</dd>
					</dl></UiCard
				><UiCard v-if="data.litellm_budget_table"
					><h3>Budget & Rate Limits</h3>
					<dl>
						<template v-if="data.litellm_budget_table.max_budget != null"
							><dt>Max Budget</dt>
							<dd>{{ money(data.litellm_budget_table.max_budget, 4) }}</dd></template
						><template v-if="data.litellm_budget_table.budget_duration"
							><dt>Budget Duration</dt>
							<dd>{{ data.litellm_budget_table.budget_duration }}</dd></template
						><template v-if="data.litellm_budget_table.tpm_limit != null"
							><dt>TPM Limit</dt>
							<dd>{{ data.litellm_budget_table.tpm_limit.toLocaleString() }}</dd></template
						><template v-if="data.litellm_budget_table.rpm_limit != null"
							><dt>RPM Limit</dt>
							<dd>{{ data.litellm_budget_table.rpm_limit.toLocaleString() }}</dd></template
						>
					</dl></UiCard
				>
			</div></template
		>
	</section>
</template>
