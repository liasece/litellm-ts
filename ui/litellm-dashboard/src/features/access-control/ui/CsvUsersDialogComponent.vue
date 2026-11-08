<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiPagination from "../../platform/ui/UiPagination.vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { createCsvUsersStore } from "../stores/CsvUsersStore";
import type { AccessCatalog, AccessRecord } from "../support/AccessModels";
import type { CsvUserRow } from "../support/CsvUserModels";
const props = defineProps<{ open: boolean; catalog: AccessCatalog; sso?: boolean }>(),
	emit = defineEmits<{ "update:open": [value: boolean]; created: [] }>();
const store = createCsvUsersStore(
		() => props.catalog.teams,
		() => Boolean(props.sso),
		() => emit("created"),
	),
	{ state } = store,
	input = ref<HTMLInputElement>();
const columns = [
	{ key: "rowNumber", label: "Row", width: 80 },
	{ key: "user_email", label: "Email" },
	{ key: "user_role", label: "Role" },
	{ key: "teams", label: "Teams" },
	{ key: "max_budget", label: "Budget" },
	{ key: "status", label: "Status" },
];
const complete = computed(() => state.rows.some((row) => row.status === "success" || row.status === "failed")),
	valid = computed(() => state.rows.filter((row) => row.isValid).length),
	rows = computed(() => state.rows.slice((state.page - 1) * 5, state.page * 5));
function row(value: AccessRecord) {
	return value as unknown as CsvUserRow;
}
function file(event: Event) {
	const selected = (event.target as HTMLInputElement).files?.[0];
	if (selected) void store.upload(selected);
}
function drop(event: DragEvent) {
	event.preventDefault();
	const selected = event.dataTransfer?.files[0];
	if (selected) void store.upload(selected);
}
function download(content: string, name: string) {
	const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}
async function copy(value: string) {
	await navigator.clipboard.writeText(value);
}
onBeforeUnmount(store.dispose);
</script>
<template>
	<UiDialog
		scroll-mode="overlay"
		:open="open"
		title="Bulk Invite Users"
		:width="800"
		:show-footer="false"
		class="access-csv-dialog"
		@update:open="emit('update:open', $event)"
		><div v-if="!state.rows.length">
			<header class="access-csv-step">
				<span>1</span>
				<h3>Download and fill the template</h3>
			</header>
			<div class="access-csv-content">
				<p>Add multiple users at once by following these steps:</p>
				<ol>
					<li>Download our CSV template</li>
					<li>Add your users' information to the spreadsheet</li>
					<li>Save the file and upload it here</li>
					<li>After creation, download the results file containing the Virtual Keys for each user</li>
				</ol>
				<section class="access-csv-columns">
					<h4>Template Column Names</h4>
					<div>
						<div class="access-csv-column-item">
							<span class="access-csv-dot access-csv-dot--required"></span>
							<div>
								<p><strong>user_email</strong><small>User's email address (required)</small></p>
							</div>
						</div>
						<div class="access-csv-column-item">
							<span class="access-csv-dot access-csv-dot--required"></span>
							<div>
								<p>
									<strong>user_role</strong
									><small
										>User's role (one of: "proxy_admin", "proxy_admin_viewer", "internal_user",
										"internal_user_viewer")</small
									>
								</p>
							</div>
						</div>
						<div class="access-csv-column-item">
							<span class="access-csv-dot"></span>
							<div>
								<p><strong>teams</strong><small>Comma-separated team IDs (e.g., "team-1,team-2")</small></p>
							</div>
						</div>
						<div class="access-csv-column-item">
							<span class="access-csv-dot"></span>
							<div>
								<p><strong>max_budget</strong><small>Maximum budget as a number (e.g., "100")</small></p>
							</div>
						</div>
						<div class="access-csv-column-item">
							<span class="access-csv-dot"></span>
							<div>
								<p><strong>budget_duration</strong><small>Budget reset period (e.g., "30d", "1mo")</small></p>
							</div>
						</div>
						<div class="access-csv-column-item">
							<span class="access-csv-dot"></span>
							<div>
								<p><strong>models</strong><small>Comma-separated allowed models (e.g., "gpt-3.5-turbo,gpt-4")</small></p>
							</div>
						</div>
					</div>
				</section>
				<UiButton variant="primary" size="large" @click="download(store.template(), 'bulk_users_template.csv')"
					><UiLucideIcon name="Download" :size="16" />Download CSV Template</UiButton
				>
			</div>
			<header class="access-csv-step">
				<span>2</span>
				<h3>Upload your completed CSV</h3>
			</header>
			<div class="access-csv-content">
				<input ref="input" type="file" accept=".csv" hidden @change="file" />
				<section v-if="state.fileName" class="access-csv-selected" :class="{ 'access-csv-selected--error': state.fileError }">
					<div>
						<strong>{{ state.fileName }}</strong
						><small>{{ (state.fileSize / 1024).toFixed(1) }} KB • {{ new Date().toLocaleDateString() }}</small>
					</div>
					<UiButton size="small" @click="store.clear">Remove</UiButton>
					<p v-if="state.fileError">{{ state.fileError }}</p>
				</section>
				<button v-else type="button" class="access-csv-drop" @click="input?.click()" @dragover.prevent @drop="drop">
					<UiLucideIcon name="Upload" :size="30" />
					<p>Drag and drop your CSV file here</p>
					<p>or</p>
					<span>Browse files</span><small>Only CSV files (.csv) are supported</small></button
				><UiAlert v-if="state.structureError" type="warning" title="CSV Structure Error"
					><p>{{ state.structureError }}</p>
					<p>Please download our template and ensure your CSV follows the required format.</p></UiAlert
				>
			</div>
		</div>
		<div v-else>
			<header class="access-csv-step">
				<span>3</span>
				<h3>{{ complete ? "User Creation Results" : "Review and create users" }}</h3>
			</header>
			<div class="access-csv-content">
				<UiAlert v-if="state.parseError" type="error" :title="state.parseError"
					><ul v-if="state.rows.some((row) => !row.isValid)">
						<li>Check the table below for specific errors in each row</li>
						<li>Common issues include invalid email formats, missing required fields, or incorrect role values</li>
						<li>Fix these issues in your CSV file and upload again</li>
					</ul></UiAlert
				>
				<header class="access-csv-review-header">
					<div>
						<span>{{ complete ? "Creation Summary" : "User Preview" }}</span
						><strong v-if="complete">{{ state.rows.filter((row) => row.status === "success").length }} Successful</strong
						><strong v-if="complete && state.rows.some((row) => row.status === 'failed')"
							>{{ state.rows.filter((row) => row.status === "failed").length }} Failed</strong
						><strong v-if="!complete">{{ valid }} of {{ state.rows.length }} users valid</strong>
					</div>
					<div v-if="!complete" class="access-tags">
						<UiButton
							@click="
								state.rows = [];
								state.parseError = '';
							"
							>Back</UiButton
						><UiButton variant="primary" :disabled="!valid || state.processing" @click="store.create">{{
							state.processing ? "Creating..." : "Create " + valid + " Users"
						}}</UiButton>
					</div>
				</header>
				<UiAlert v-if="state.rows.some((row) => row.status === 'success')" title="User creation complete"
					><p>
						<strong>Next step:</strong> Download the credentials file containing Virtual Keys and invitation links. Users will
						need these Virtual Keys to make LLM requests through LiteLLM.
					</p></UiAlert
				><UiTable :rows="rows as unknown as AccessRecord[]" :columns="columns" row-key="rowNumber" compact
					><template #cell-status="{ row: entry }"
						><div v-if="!row(entry).isValid" class="access-danger">
							Invalid
							<p>{{ row(entry).error }}</p>
						</div>
						<span v-else-if="!row(entry).status || row(entry).status === 'pending'" class="access-muted">Pending</span>
						<div v-else>
							<span :class="row(entry).status === 'success' ? 'access-success-text' : 'access-danger'">{{
								row(entry).status === "success" ? "Success" : "Failed"
							}}</span>
							<p v-if="row(entry).invitation_link">
								<span class="access-csv-link">{{ row(entry).invitation_link }}</span
								><button type="button" @click="copy(row(entry).invitation_link ?? '')">Copy</button>
							</p>
							<p v-if="row(entry).error" class="access-danger">{{ row(entry).error }}</p>
						</div></template
					></UiTable
				><UiPagination v-model="state.page" :total="state.rows.length" :page-size="5" />
				<footer class="access-form-footer">
					<template v-if="complete"
						><UiButton @click="store.clear">Start New Bulk Import</UiButton
						><UiButton variant="primary" @click="download(store.results(), 'bulk_users_results.csv')"
							>Download User Credentials</UiButton
						></template
					><template v-else
						><UiButton
							@click="
								state.rows = [];
								state.parseError = '';
							"
							>Back</UiButton
						><UiButton variant="primary" :disabled="!valid || state.processing" @click="store.create">{{
							state.processing ? "Creating..." : "Create " + valid + " Users"
						}}</UiButton></template
					>
				</footer>
			</div>
		</div></UiDialog
	>
</template>
