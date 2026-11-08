<script setup lang="ts">
import { computed } from "vue";
import UiTable from "../../../platform/ui/UiTable.vue";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import type { GuardrailPattern, GuardrailKeyword, GuardrailAction } from "../../support/GuardrailModels";
const props = defineProps<{ patterns?: GuardrailPattern[]; keywords?: GuardrailKeyword[] }>(),
	emit = defineEmits<{ remove: [id: string]; action: [id: string, value: GuardrailAction] }>(),
	isPattern = computed(() => props.patterns !== undefined),
	rows = computed(() => (props.patterns ?? props.keywords ?? []).map((row) => ({ ...row }))),
	columns = computed(() =>
		isPattern.value
			? [
					{ key: "type", label: "Type", width: 100 },
					{ key: "name", label: "Pattern name" },
					{ key: "pattern", label: "Regex pattern" },
					{ key: "action", label: "Action", width: 150 },
					{ key: "actions", label: "", width: 100 },
				]
			: [
					{ key: "keyword", label: "Keyword" },
					{ key: "action", label: "Action", width: 150 },
					{ key: "description", label: "Description" },
					{ key: "actions", label: "", width: 100 },
				],
	);
function action(id: string, value: unknown) {
	if (value === "BLOCK" || value === "MASK") emit("action", id, value);
}
</script>
<template>
	<div v-if="!rows.length" class="guardrail-content-empty">{{ isPattern ? "No patterns added." : "No keywords added." }}</div>
	<UiTable v-else :columns="columns" :rows="rows" row-key="id" compact class="guardrail-content-table"
		><template #cell-type="{ value }"
			><UiTag :color="value === 'prebuilt' ? 'blue' : 'green'">{{ value === "prebuilt" ? "Prebuilt" : "Custom" }}</UiTag></template
		><template #cell-name="{ row }">{{ row.display_name || row.name }}</template
		><template #cell-pattern="{ value }"
			><code v-if="value" class="guardrail-pattern-code">{{ String(value).substring(0, 40) }}...</code
			><template v-else>-</template></template
		><template #cell-description="{ value }">{{ value || "-" }}</template
		><template #cell-action="{ row }"
			><UiSelect
				:model-value="String(row.action)"
				:options="[
					{ value: 'BLOCK', label: 'Block' },
					{ value: 'MASK', label: 'Mask' },
				]"
				size="small"
				style="width: 120px"
				@update:model-value="action(String(row.id), $event)" /></template
		><template #cell-actions="{ row }"
			><UiButton variant="text" danger size="small" @click="emit('remove', String(row.id))"
				><UiIcon name="DeleteOutlined" />Delete</UiButton
			></template
		></UiTable
	>
</template>
