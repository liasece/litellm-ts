<script setup lang="ts">
import { computed, reactive } from "vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import { getGuardrailLogoAndName } from "../logic/GuardrailProviderLogic";
import { legacyGuardrailText } from "../support/GuardrailClipboardSupport";
import type { GuardrailRecord } from "../support/GuardrailModels";
const props = defineProps<{ rows: GuardrailRecord[]; loading: boolean }>(),
	emit = defineEmits<{ select: [id: string]; delete: [row: GuardrailRecord] }>(),
	sort = reactive({ key: "created_at", order: "desc" as "asc" | "desc" | null }),
	columns = [
		{ key: "guardrail_id", label: "Guardrail ID" },
		{ key: "guardrail_name", label: "Name" },
		{ key: "guardrail", label: "Provider" },
		{ key: "mode", label: "Mode" },
		{ key: "default_on", label: "Default On" },
		{ key: "created_at", label: "Created At" },
		{ key: "updated_at", label: "Updated At" },
		{ key: "actions", label: "Actions" },
	],
	value = (row: GuardrailRecord, key: string) => (["guardrail", "mode", "default_on"].includes(key) ? row.litellm_params[key] : row[key]),
	rows = computed(() => {
		if (!sort.order) return props.rows;
		return [...props.rows].sort((a, b) => {
			const first = value(a, sort.key),
				second = value(b, sort.key);
			if (first === undefined) return 1;
			if (second === undefined) return -1;
			const result =
				typeof first === "boolean" && typeof second === "boolean"
					? Number(first) - Number(second)
					: String(first ?? "")
							.toLowerCase()
							.localeCompare(String(second ?? "").toLowerCase(), "en", { numeric: true });
			return sort.order === "desc" ? -result : result;
		});
	});
function toggle(key: string) {
	if (key === "actions") return;
	const desc = typeof (props.rows[0] ? value(props.rows[0], key) : undefined) !== "string";
	if (sort.key !== key) {
		sort.key = key;
		sort.order = desc ? "desc" : "asc";
	} else if (sort.order === (desc ? "desc" : "asc")) sort.order = desc ? "asc" : "desc";
	else if (sort.order) sort.order = null;
	else sort.order = desc ? "desc" : "asc";
}
const date = (value?: string) => (value ? new Date(value).toLocaleString() : "-");
function hide(event: Event) {
	(event.target as HTMLImageElement).style.display = "none";
}
</script>
<template>
	<div class="guardrail-table-region">
		<div>
			<table>
				<thead>
					<tr>
						<th
							v-for="column in columns"
							:key="column.key"
							scope="col"
							:class="{ actions: column.key === 'actions' }"
							@click="toggle(column.key)"
						>
							<div>
								{{ column.label
								}}<span v-if="column.key !== 'actions'"
									><UiHeroIcon
										v-if="sort.key === column.key && sort.order"
										:name="sort.order === 'asc' ? 'ChevronUpIcon' : 'ChevronDownIcon'"
										:size="16"
										class="sorted" /><UiHeroIcon v-else name="SwitchVerticalIcon" :size="16"
								/></span>
							</div>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-if="loading || !rows.length">
						<td :colspan="8" class="guardrail-table-empty">{{ loading ? "Loading..." : "No guardrails found" }}</td>
					</tr>
					<tr v-for="row in loading ? [] : rows" :key="row.guardrail_id">
						<td>
							<UiButton
								appearance="tremor"
								variant="text"
								size="small"
								class="guardrail-id-button"
								:title="row.guardrail_id || ''"
								@click="row.guardrail_id && emit('select', row.guardrail_id)"
								>{{ row.guardrail_id ? row.guardrail_id.slice(0, 7) + "..." : "" }}</UiButton
							>
						</td>
						<td>
							<strong :title="row.guardrail_name || undefined">{{ row.guardrail_name || "-" }}</strong>
						</td>
						<td>
							<span class="guardrail-table-provider"
								><img
									v-if="getGuardrailLogoAndName(row.litellm_params.guardrail).logo"
									:src="getGuardrailLogoAndName(row.litellm_params.guardrail).logo"
									:alt="getGuardrailLogoAndName(row.litellm_params.guardrail).displayName + ' logo'"
									@error="hide"
								/><span class="guardrail-cell-text">{{
									getGuardrailLogoAndName(row.litellm_params.guardrail).displayName
								}}</span></span
							>
						</td>
						<td>
							<span class="guardrail-cell-text">{{ legacyGuardrailText(row.litellm_params.mode) }}</span>
						</td>
						<td>
							<UiTag appearance="tremor" size="xs" :color="row.litellm_params.default_on ? 'green' : 'gray'"
								>Default {{ row.litellm_params.default_on ? "On" : "Off" }}</UiTag
							>
						</td>
						<td :title="row.created_at">
							<span class="guardrail-cell-text">{{ date(row.created_at) }}</span>
						</td>
						<td :title="row.updated_at">
							<span class="guardrail-cell-text">{{ date(row.updated_at) }}</span>
						</td>
						<td class="actions">
							<div class="guardrail-actions">
								<span
									v-if="row.guardrail_definition_location === 'config'"
									class="guardrail-config-delete"
									title="Config guardrail cannot be deleted on the dashboard. Please delete it from the config file."
									aria-label="Delete guardrail (config)"
									><UiHeroIcon name="TrashIcon" :size="20" /></span
								><button
									v-else
									type="button"
									class="guardrail-delete"
									title="Delete guardrail"
									aria-label="Delete guardrail"
									@click="row.guardrail_id && emit('delete', row)"
								>
									<UiHeroIcon name="TrashIcon" :size="20" />
								</button>
							</div>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>
</template>
