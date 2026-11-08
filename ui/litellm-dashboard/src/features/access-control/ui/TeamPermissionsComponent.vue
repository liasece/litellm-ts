<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiEmptyState from "../../platform/ui/UiEmptyState.vue";
import AccessNoticeComponent from "./AccessNoticeComponent.vue";
import { accessApi } from "../api/AccessApi";
import { getPermissionInfo } from "../logic/TeamPermissionLogic";
const props = defineProps<{ teamId: string; canEdit: boolean }>();
const permissions = ref<string[]>([]),
	selected = ref<string[]>([]),
	saved = ref<string[]>([]),
	loading = ref(true),
	pending = ref(false),
	error = ref(""),
	message = ref("");
const changed = computed(() => JSON.stringify([...selected.value].sort()) !== JSON.stringify([...saved.value].sort()));
async function refresh() {
	loading.value = true;
	try {
		const result = await accessApi.teamPermissions(props.teamId);
		permissions.value = result.all_available_permissions ?? [];
		selected.value = result.team_member_permissions ?? [];
		saved.value = [...selected.value];
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Failed to load permissions";
	} finally {
		loading.value = false;
	}
}
function toggle(value: string, checked: boolean) {
	selected.value = checked ? [...selected.value, value] : selected.value.filter((item) => item !== value);
}
async function save() {
	pending.value = true;
	try {
		await accessApi.updateTeamPermissions(props.teamId, selected.value);
		saved.value = [...selected.value];
		message.value = "Permissions updated successfully";
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : "Failed to update permissions";
	} finally {
		pending.value = false;
	}
}
onMounted(() => void refresh());
</script>
<template>
	<p v-if="loading" class="access-center">Loading permissions...</p>
	<UiCard v-else class="access-member-permissions"
		><AccessNoticeComponent :error="error" :message="message" />
		<header>
			<h3>Member Permissions</h3>
			<div v-if="canEdit && changed" class="access-tags">
				<UiButton @click="refresh">Reset</UiButton
				><UiButton variant="primary" :loading="pending" @click="save">Save Changes</UiButton>
			</div>
		</header>
		<p>Control what team members can do when they are not team admins.</p>
		<div v-if="permissions.length" class="access-table-scroll">
			<table class="access-permission-table">
				<thead>
					<tr>
						<th>Method</th>
						<th>Endpoint</th>
						<th>Description</th>
						<th>Allow Access</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="permission in permissions" :key="permission">
						<td>
							<span :class="getPermissionInfo(permission).method === 'GET' ? 'access-method-get' : 'access-method-post'">{{
								getPermissionInfo(permission).method
							}}</span>
						</td>
						<td>
							<code>{{ permission }}</code>
						</td>
						<td>{{ getPermissionInfo(permission).description }}</td>
						<td>
							<UiCheckbox
								:model-value="selected.includes(permission)"
								:label="'Allow ' + permission"
								:disabled="!canEdit"
								@update:model-value="toggle(permission, $event)"
							/>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<UiEmptyState v-else description="No permissions available"
	/></UiCard>
</template>
