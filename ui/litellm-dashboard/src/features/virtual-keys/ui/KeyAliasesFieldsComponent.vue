<script setup lang="ts">
import KeyHeroIcon from "./KeyHeroIconComponent.vue";
import { ref } from "vue";
import { useKeyFieldIdentity } from "../support/KeyFormIdentity";
import notificationManager from "../../notifications/logic/NotificationManager";
import "./styles/KeyAliasesForms.css";
import UiSelect from "../../platform/ui/UiSelect.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { selectedString, selectOptions, type KeyDraft } from "../support/VirtualKeyModels";
const draft = defineModel<KeyDraft>({ required: true });
const fieldIdentity = useKeyFieldIdentity();
defineProps<{ models: readonly string[] }>();
const alias = ref("");
const target = ref("");
const editing = ref<string | null>(null);
const editedName = ref("");
const editedTarget = ref("");
function add() {
	if (!alias.value || !target.value) {
		notificationManager.fromBackend("Please provide both alias name and target model");
		return;
	}
	if (Object.prototype.hasOwnProperty.call(draft.value.aliases, alias.value)) {
		notificationManager.fromBackend("An alias with this name already exists");
		return;
	}
	draft.value.aliases = { ...draft.value.aliases, [alias.value]: target.value };
	alias.value = "";
	target.value = "";
	notificationManager.success("Alias added successfully");
}
function edit(name: string, model: string) {
	editing.value = name;
	editedName.value = name;
	editedTarget.value = model;
}
function save() {
	if (!editing.value || !editedName.value || !editedTarget.value) {
		notificationManager.fromBackend("Please provide both alias name and target model");
		return;
	}
	if (editedName.value !== editing.value && Object.prototype.hasOwnProperty.call(draft.value.aliases, editedName.value)) {
		notificationManager.fromBackend("An alias with this name already exists");
		return;
	}
	const updated = Object.fromEntries(
		Object.entries(draft.value.aliases).map(([name, model]) =>
			name === editing.value ? [editedName.value, editedTarget.value] : [name, model],
		),
	);
	draft.value.aliases = updated;
	editing.value = null;
	notificationManager.success("Alias updated successfully");
}
function remove(name: string) {
	const updated = { ...draft.value.aliases };
	delete updated[name];
	draft.value.aliases = updated;
	notificationManager.success("Alias deleted successfully");
}
</script>
<template>
	<div class="vk-alias-manager">
		<div class="vk-alias-new">
			<p class="vk-alias-section-title">Add New Alias</p>
			<div class="vk-alias-inputs">
				<div>
					<label :for="fieldIdentity('new-alias-name')">Alias Name</label
					><input
						:id="fieldIdentity('new-alias-name')"
						v-model="alias"
						type="text"
						placeholder="e.g., gpt-4o"
						class="vk-alias-name-input"
					/>
				</div>
				<div>
					<label>Target Model</label
					><UiSelect
						:model-value="target || null"
						:options="selectOptions(models)"
						searchable
						placeholder=""
						aria-label="Target Model"
						@update:model-value="target = selectedString($event)"
					/>
				</div>
				<div class="vk-alias-add-cell">
					<button type="button" class="vk-alias-add" :disabled="!alias || !target" @click="add">
						<KeyHeroIcon name="PlusCircleIcon" />Add Alias
					</button>
				</div>
			</div>
		</div>
		<p class="vk-alias-section-title">Manage Existing Aliases</p>
		<div class="vk-alias-table-border">
			<div class="vk-alias-table-scroll">
				<table class="vk-alias-table">
					<thead>
						<tr>
							<th>Alias Name</th>
							<th>Target Model</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(model, name) in draft.aliases" :key="name" class="vk-alias-row">
							<template v-if="editing === name">
								<td>
									<input
										v-model="editedName"
										type="text"
										aria-label="Edit alias name"
										class="vk-alias-name-input vk-alias-name-input--editing"
									/>
								</td>
								<td>
									<UiSelect
										:model-value="editedTarget"
										:options="selectOptions(models)"
										searchable
										aria-label="Edit target model"
										@update:model-value="editedTarget = selectedString($event)"
									/>
								</td>
								<td>
									<div class="vk-alias-row-actions">
										<button type="button" class="vk-alias-edit" @click="save">Save</button
										><button type="button" class="vk-alias-cancel" @click="editing = null">Cancel</button>
									</div>
								</td>
							</template>
							<template v-else>
								<td class="vk-alias-name">
									<ModelName class="vk-alias-target" :model="String(name)" :size="14" />
								</td>
								<td>
									<ModelName class="vk-alias-target" :model="model" :size="14" />
								</td>
								<td>
									<div class="vk-alias-row-actions">
										<button
											type="button"
											class="vk-alias-edit"
											aria-label="Edit alias"
											@click="edit(String(name), model)"
										>
											<KeyHeroIcon name="PencilIcon" /></button
										><button
											type="button"
											class="vk-alias-delete"
											aria-label="Delete alias"
											@click="remove(String(name))"
										>
											<KeyHeroIcon name="TrashIcon" />
										</button>
									</div>
								</td>
							</template>
						</tr>
						<tr v-if="!Object.keys(draft.aliases).length">
							<td colspan="3" class="vk-alias-empty">No aliases added yet. Add a new alias above.</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>
