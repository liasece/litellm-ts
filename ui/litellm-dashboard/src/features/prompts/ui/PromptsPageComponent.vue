<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ProviderLogoComponent from "../../providers/ui/ProviderLogoComponent.vue";
import { getModelLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import { copyToolText } from "../../tools/support/ToolClipboardSupport";
import { promptsApi } from "../api/PromptsApi";
import { extractPromptModel, promptProvider } from "../logic/PromptDisplayLogic";
import type { PromptSpec, PromptInfoResponse, PromptModelGroup } from "../support/PromptModels";
import PromptDetailsComponent from "./PromptDetailsComponent.vue";
import PromptEditorDialogComponent from "./PromptEditorDialogComponent.vue";
import PromptUploadDialogComponent from "./PromptUploadDialogComponent.vue";
import PromptDeleteDialogComponent from "./PromptDeleteDialogComponent.vue";
import "../styles/PromptsStyles.css";
const auth = useAuthenticationStore(),
	rows = ref<PromptSpec[]>([]),
	loading = ref(false),
	groups = ref(new Map<string, PromptModelGroup>()),
	selected = ref(""),
	editor = ref(false),
	upload = ref(false),
	initial = ref<PromptInfoResponse | null>(null),
	deleting = ref<PromptSpec | null>(null),
	pending = ref(false),
	sort = ref({ key: "created_at", order: "desc" as "asc" | "desc" | null }),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	columns = computed(() => [
		{ key: "prompt_id", label: "Prompt ID" },
		{ key: "model", label: "Model" },
		{ key: "created_at", label: "Created At" },
		{ key: "updated_at", label: "Updated At" },
		{ key: "type", label: "Type" },
		...(admin.value ? [{ key: "actions", label: "Actions" }] : []),
	]);
let generation = 0,
	disposed = false;
function value(row: PromptSpec, key: string) {
	if (key === "model") return extractPromptModel(row);
	if (key === "type") return row.prompt_info?.prompt_type;
	return row[key];
}
const ordered = computed(() => {
	if (!sort.value.order) return rows.value;
	const result = [...rows.value],
		{ key, order } = sort.value;
	return result.sort((a, b) => {
		const left = value(a, key),
			right = value(b, key);
		if (left == null && right == null) return 0;
		if (left == null) return 1;
		if (right == null) return -1;
		const x = String(left).toLowerCase(),
			y = String(right).toLowerCase();
		return (x < y ? -1 : x > y ? 1 : 0) * (order === "asc" ? 1 : -1);
	});
});
function toggle(key: string) {
	if (key === "actions") return;
	sort.value = {
		key,
		order: sort.value.key === key ? (sort.value.order === "asc" ? "desc" : sort.value.order === "desc" ? null : "asc") : "asc",
	};
}
async function refresh() {
	if (!auth.isAuthorized.value) {
		rows.value = [];
		return;
	}
	const current = ++generation;
	loading.value = true;
	try {
		const value = await promptsApi.list();
		if (!disposed && current === generation) rows.value = value;
	} catch {
		if (!disposed && current === generation) notificationManager.fromBackend("Failed to load prompts");
	} finally {
		if (!disposed && current === generation) loading.value = false;
	}
}
watch(
	auth.isAuthorized,
	(authorized) => {
		void refresh();
		if (authorized)
			void promptsApi
				.modelHub()
				.then((value) => {
					if (!disposed) groups.value = new Map(value.map((group) => [group.model_group, group]));
				})
				.catch(() => {
					if (!disposed) groups.value = new Map();
				});
		else groups.value = new Map();
	},
	{ immediate: true },
);
function create() {
	selected.value = "";
	initial.value = null;
	editor.value = true;
}
function edit(value: PromptInfoResponse) {
	initial.value = value;
	editor.value = true;
}
function success() {
	void refresh();
	editor.value = false;
	initial.value = null;
	selected.value = "";
}
async function remove() {
	const row = deleting.value;
	if (!row || !auth.isAuthorized.value) return;
	pending.value = true;
	try {
		await promptsApi.delete(row.prompt_id);
		notificationManager.success('Prompt "' + row.prompt_id + '" deleted successfully');
		await refresh();
	} catch {
		notificationManager.fromBackend("Failed to delete prompt");
	} finally {
		pending.value = false;
		deleting.value = null;
	}
}
function logo(row: PromptSpec) {
	const model = extractPromptModel(row) || "";
	return getModelLogoAndName(promptProvider(model, groups.value), model);
}
function date(value?: string | null) {
	return value ? new Date(value).toLocaleString() : "-";
}
onBeforeUnmount(() => {
	disposed = true;
	++generation;
});
</script>
<template>
	<main class="prompts-page">
		<div class="prompts-toolbar">
			<UiButton appearance="tremor" variant="primary" :disabled="!auth.isAuthorized.value" @click="create">+ Add New Prompt</UiButton
			><UiButton
				appearance="tremor"
				:disabled="!auth.isAuthorized.value"
				@click="
					selected = '';
					upload = true;
				"
				>Upload .prompt File</UiButton
			>
		</div>
		<div class="prompts-table-wrap">
			<div>
				<table class="prompts-table">
					<thead>
						<tr>
							<th v-for="column in columns" :key="column.key" @click="toggle(column.key)">
								<div>
									<span>{{ column.label }}</span
									><UiHeroIcon
										:name="
											sort.key === column.key && sort.order === 'asc'
												? 'ChevronUpIcon'
												: sort.key === column.key && sort.order === 'desc'
													? 'ChevronDownIcon'
													: 'SwitchVerticalIcon'
										"
										:class="{ active: sort.key === column.key && Boolean(sort.order) }"
										:size="16"
									/>
								</div>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-if="loading || !ordered.length">
							<td :colspan="columns.length" class="prompts-table-state">{{ loading ? "Loading..." : "No prompts found" }}</td>
						</tr>
						<tr v-for="row in loading ? [] : ordered" :key="row.prompt_id">
							<td>
								<div class="prompt-table-id">
									<UiTooltip :title="row.prompt_id"
										><UiButton
											appearance="tremor"
											variant="text"
											size="small"
											data-prompt-size="xs"
											@click="selected = row.prompt_id"
											>{{ row.prompt_id.length > 25 ? row.prompt_id.slice(0, 25) + "..." : row.prompt_id }}</UiButton
										></UiTooltip
									><UiTooltip title="Copy prompt ID"
										><button type="button" aria-label="Copy prompt ID" @click="copyToolText(row.prompt_id)">
											<UiIcon name="CopyOutlined" :size="12" /></button
									></UiTooltip>
								</div>
							</td>
							<td>
								<UiTooltip v-if="extractPromptModel(row)" :title="extractPromptModel(row) || ''"
									><div class="prompt-table-model">
										<ProviderLogoComponent
											:provider="promptProvider(extractPromptModel(row), groups) || ''"
											:logo="logo(row).logo"
										/><span>{{ extractPromptModel(row) }}</span>
									</div></UiTooltip
								><span v-else class="prompt-no-model">-</span>
							</td>
							<td>
								<UiTooltip :title="row.created_at || ''"
									><span>{{ date(row.created_at) }}</span></UiTooltip
								>
							</td>
							<td>
								<UiTooltip :title="row.updated_at || ''"
									><span>{{ date(row.updated_at) }}</span></UiTooltip
								>
							</td>
							<td>
								<UiTooltip :title="row.prompt_info?.prompt_type || ''"
									><span>{{ row.prompt_info?.prompt_type || "-" }}</span></UiTooltip
								>
							</td>
							<td v-if="admin">
								<UiTooltip title="Delete prompt"
									><UiButton
										appearance="tremor"
										variant="text"
										size="small"
										data-prompt-size="xs"
										class="prompt-table-delete"
										aria-label="Delete prompt"
										@click="deleting = row"
										><UiHeroIcon name="TrashIcon" :size="16" /></UiButton
								></UiTooltip>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
		<PromptDetailsComponent
			v-if="selected"
			:key="selected"
			:prompt-id="selected"
			:admin="admin"
			@close="selected = ''"
			@deleted="refresh"
			@edit="edit"
		/><PromptEditorDialogComponent
			v-if="editor"
			v-model:open="editor"
			:initial="initial"
			@saved="success"
		/><PromptUploadDialogComponent v-model:open="upload" @saved="success" /><PromptDeleteDialogComponent
			:open="Boolean(deleting)"
			:prompt-id="deleting?.prompt_id || ''"
			:pending="pending"
			@update:open="!$event && (deleting = null)"
			@confirm="remove"
		/>
	</main>
</template>
