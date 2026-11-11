<script setup lang="ts">
import { reactive, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import AccessActionComponent from "./AccessActionComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import type { ResourceOption } from "../support/AccessModels";
const aliases = defineModel<Record<string, string>>({ required: true });
defineProps<{ models: ResourceOption[] }>();
const draft = reactive({ name: "", model: "" }),
	editing = ref<string | null>(null),
	edit = reactive({ name: "", model: "" }),
	error = ref("");
function add() {
	error.value = "";
	if (!draft.name || !draft.model) {
		error.value = "Please provide both alias name and target model";
		return;
	}
	if (Object.prototype.hasOwnProperty.call(aliases.value, draft.name)) {
		error.value = "An alias with this name already exists";
		return;
	}
	aliases.value = { ...aliases.value, [draft.name]: draft.model };
	draft.name = "";
	draft.model = "";
}
function save() {
	error.value = "";
	if (!edit.name || !edit.model) {
		error.value = "Please provide both alias name and target model";
		return;
	}
	if (edit.name !== editing.value && Object.prototype.hasOwnProperty.call(aliases.value, edit.name)) {
		error.value = "An alias with this name already exists";
		return;
	}
	const next = { ...aliases.value };
	if (editing.value) delete next[editing.value];
	next[edit.name] = edit.model;
	aliases.value = next;
	editing.value = null;
}
function remove(name: string) {
	const next = { ...aliases.value };
	delete next[name];
	aliases.value = next;
}
</script>
<template>
	<div class="access-aliases">
		<UiAlert v-if="error" type="error" :title="error" />
		<p>Add New Alias</p>
		<div class="access-alias-add">
			<label>Alias Name<UiInput v-model="draft.name" placeholder="e.g., gpt-4o" /></label
			><label>Target Model<UiSelect v-model="draft.model" :options="models" searchable placeholder="Select target model" /></label
			><UiButton :disabled="!draft.name || !draft.model" @click="add">＋ Add Alias</UiButton>
		</div>
		<p>Manage Existing Aliases</p>
		<table class="access-alias-table">
			<thead>
				<tr>
					<th>Alias Name</th>
					<th>Target Model</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(target, name) in aliases" :key="name">
					<template v-if="editing === String(name)"
						><td><UiInput v-model="edit.name" /></td>
						<td><UiSelect v-model="edit.model" :options="models" searchable /></td>
						<td>
							<UiButton size="small" @click="save">Save</UiButton
							><UiButton size="small" @click="editing = null">Cancel</UiButton>
						</td></template
					><template v-else
						><td>
							<ModelName class="access-model-item" :model="String(name)" :size="14" />
						</td>
						<td>
							<ModelName class="access-model-item" :model="String(target)" :size="14" />
						</td>
						<td>
							<AccessActionComponent
								name="Pencil"
								label="Edit alias"
								@click="
									editing = String(name);
									edit.name = String(name);
									edit.model = target;
								"
							/><AccessActionComponent name="Trash2" label="Delete alias" danger @click="remove(String(name))" /></td
					></template>
				</tr>
				<tr v-if="!Object.keys(aliases).length">
					<td colspan="3" class="access-muted">No aliases added yet. Add a new alias above.</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
