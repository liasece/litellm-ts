<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import AccessActionComponent from "../../access-control/ui/AccessActionComponent.vue";
import AccessHeroIconComponent from "../../access-control/ui/AccessHeroIconComponent.vue";
import AccessDeleteDialogComponent from "../../access-control/ui/AccessDeleteDialogComponent.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import ToolsTableComponent from "./ToolsTableComponent.vue";
import VectorDetailsComponent from "./VectorDetailsComponent.vue";
import VectorCreateDialogComponent from "./VectorCreateDialogComponent.vue";
import VectorIngestComponent from "./VectorIngestComponent.vue";
import VectorTestTabComponent from "./VectorTestTabComponent.vue";
import { createResourceStore } from "../../platform/stores/ResourceStore";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { isAdminRole } from "../../identity/logic/UserRoleLogic";
import { getProviderLogoAndName } from "../../providers/logic/ProviderIdentityLogic";
import { vectorStoresApi } from "../api/VectorStoresApi";
import type { VectorStore, VectorCredential, EmbeddingModel } from "../support/VectorStoreModels";
import "../../access-control/styles/AccessStyles.css";
import "../styles/ToolsStyles.css";
import "../styles/VectorStoresStyles.css";
import "../styles/VectorTesterStyles.css";
const auth = useAuthenticationStore(),
	admin = computed(() => isAdminRole(auth.userRole.value)),
	store = createResourceStore(vectorStoresApi.list),
	{ state, ordered, rows } = store,
	tab = ref("create"),
	selected = ref(""),
	edit = ref(false),
	adding = ref(false),
	deleting = ref(""),
	refreshed = ref(""),
	credentials = ref<VectorCredential[]>([]),
	models = ref<EmbeddingModel[]>([]);
state.sortBy = "created_at";
state.sortOrder = "desc";
const columns = [
	{ key: "vector_store_id", label: "Vector Store ID", sortable: true },
	{ key: "vector_store_name", label: "Name", sortable: true },
	{ key: "vector_store_description", label: "Description", sortable: true },
	{ key: "vector_store_metadata", label: "Files", sortable: true },
	{ key: "custom_llm_provider", label: "Provider", sortable: true },
	{ key: "created_at", label: "Created At", sortable: true },
	{ key: "updated_at", label: "Updated At", sortable: true },
	{ key: "actions", label: "" },
];
function item(row: Record<string, unknown>) {
	return row as VectorStore;
}
function open(id: string, editing = false) {
	selected.value = id;
	edit.value = editing;
}
function sort(key: string) {
	store.sort(key, state.sortBy === key && state.sortOrder === "desc" ? "asc" : "desc");
}
async function loadCredentials() {
	try {
		credentials.value = await vectorStoresApi.credentials();
	} catch (error) {
		state.error = "Error fetching credentials: " + String(error);
	}
}
function refresh() {
	void store.refresh();
	void loadCredentials();
	refreshed.value = new Date().toLocaleString();
}
async function remove() {
	if (await store.run(() => vectorStoresApi.delete(deleting.value), "Vector store deleted successfully")) deleting.value = "";
}
function filenames(record: VectorStore) {
	const files = record.vector_store_metadata?.ingested_files || [];
	return files.map((file) => file.filename || file.file_url || "Unknown").join(", ");
}
function fileLabel(record: VectorStore) {
	const files = record.vector_store_metadata?.ingested_files || [];
	return !files.length ? "-" : files.length === 1 ? files[0]?.filename || files[0]?.file_url || "1 file" : files.length + " files";
}
onMounted(() => {
	void store.refresh();
	void loadCredentials();
	void vectorStoresApi
		.models()
		.then((value) => {
			models.value = value;
		})
		.catch(() => {});
});
onBeforeUnmount(store.dispose);
</script>
<template>
	<main class="tools-vector-page" :class="{ 'tools-vector-page--detail': Boolean(selected) }">
		<AccessNoticeComponent :error="state.error" :message="state.message" /><VectorDetailsComponent
			v-if="selected"
			:key="selected"
			:id="selected"
			:edit="edit"
			:admin="admin"
			@close="
				selected = '';
				edit = false;
				store.refresh();
			"
			@notice="state.message = $event"
			@error="state.error = $event"
		/>
		<div v-else class="tools-vector-main">
			<header>
				<h1>Vector Store Management</h1>
				<div>
					<span v-if="refreshed">Last Refreshed: {{ refreshed }}</span
					><button class="tools-refresh" type="button" aria-label="Refresh vector stores" @click="refresh">
						<AccessHeroIconComponent name="Refresh" />
					</button>
				</div>
			</header>
			<p>You can use vector stores to store and retrieve LLM embeddings.</p>
			<UiTabs
				v-model="tab"
				appearance="tremor"
				:items="[
					{ key: 'create', label: 'Create Vector Store' },
					{ key: 'manage', label: 'Manage Vector Stores' },
					{ key: 'test', label: 'Test Vector Store' },
				]"
			/><VectorIngestComponent v-if="tab === 'create'" :models="models" @created="store.refresh" />
			<section v-else-if="tab === 'manage'">
				<UiButton appearance="tremor" variant="primary" class="tools-vector-add" @click="adding = true">+ Add Vector Store</UiButton
				><ToolsTableComponent
					:rows="ordered"
					:columns="columns"
					row-key="vector_store_id"
					:sort-by="state.sortBy"
					:sort-order="state.sortOrder"
					empty-text="No vector stores found"
					@sort="sort"
					><template #cell-vector_store_id="{ row }"
						><button class="tools-resource-id tools-vector-id" @click="open(item(row).vector_store_id)">
							{{
								item(row).vector_store_id.length > 15
									? item(row).vector_store_id.slice(0, 15) + "..."
									: item(row).vector_store_id
							}}
						</button></template
					><template #cell-vector_store_name="{ value }"
						><UiTooltip :title="String(value || '')"
							><span>{{ value || "-" }}</span></UiTooltip
						></template
					><template #cell-vector_store_description="{ value }"
						><UiTooltip :title="String(value || '')"
							><span>{{ value || "-" }}</span></UiTooltip
						></template
					><template #cell-vector_store_metadata="{ row }"
						><UiTooltip :title="filenames(item(row))"
							><span :style="{ color: fileLabel(item(row)) === '-' ? '#9ca3af' : '#2563eb' }">{{
								fileLabel(item(row))
							}}</span></UiTooltip
						></template
					><template #cell-custom_llm_provider="{ value }"
						><div class="tools-tags">
							<img
								v-if="getProviderLogoAndName(String(value)).logo"
								:src="getProviderLogoAndName(String(value)).logo"
								:alt="getProviderLogoAndName(String(value)).displayName"
								width="16"
								height="16"
							/>{{ getProviderLogoAndName(String(value)).displayName }}
						</div></template
					><template v-for="key in ['created_at', 'updated_at']" :key="key" #[`cell-${key}`]="{ value }">{{
						new Date(String(value)).toLocaleDateString()
					}}</template
					><template #cell-actions="{ row }"
						><div class="tools-tags">
							<AccessActionComponent
								name="SquarePen"
								label="Edit vector store"
								@click="open(item(row).vector_store_id, true)"
							/><AccessActionComponent
								name="Trash2"
								label="Delete vector store"
								@click="deleting = item(row).vector_store_id"
							/></div></template
				></ToolsTableComponent>
			</section>
			<VectorTestTabComponent
				v-else
				:rows="rows"
				@error="state.error = $event"
				@notice="state.message = $event"
			/><VectorCreateDialogComponent
				v-model:open="adding"
				:credentials="credentials"
				:models="models"
				@saved="
					state.message = 'Vector store created successfully';
					store.refresh();
				"
				@error="state.error = $event"
			/><AccessDeleteDialogComponent
				:open="Boolean(deleting)"
				title="Delete Vector Store"
				message="Are you sure you want to delete this vector store? This action cannot be undone."
				information-title="Vector Store Information"
				:information="[{ label: 'Vector Store ID', value: deleting, code: true }]"
				:pending="state.pending"
				@update:open="!$event && (deleting = '')"
				@confirm="remove"
			/>
		</div>
	</main>
</template>
