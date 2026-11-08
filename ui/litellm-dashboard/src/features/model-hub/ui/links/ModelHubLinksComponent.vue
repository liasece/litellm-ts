<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { createModelHubLinksStore } from "../../stores/ModelHubLinksStore";
import { getApiBaseUrl } from "../../../platform/api/HttpApiClient";
import UiCard from "../../../platform/ui/UiCard.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import ModelHubHeroIconComponent from "../common/ModelHubHeroIconComponent.vue";
const store = createModelHubLinksStore(),
	state = store.state,
	url = getApiBaseUrl() + "/ui/model_hub_table";
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
function open(url: string) {
	window.open(url, "_blank");
}
</script>
<template>
	<UiCard appearance="tremor" class="hub-links">
		<header class="hub-between" @click="state.expanded = !state.expanded">
			<div>
				<h2>Link Management</h2>
				<p>Manage the links that are displayed under 'Useful Links' on the public model hub.</p>
			</div>
			<div class="hub-links__toggle">
				<ModelHubHeroIconComponent :name="state.expanded ? 'ChevronDown' : 'ChevronRight'" :size="20" />
			</div>
		</header>
		<div v-if="state.expanded" class="hub-links__content">
			<div class="hub-links__add">
				<h3>Add New Link</h3>
				<div>
					<label>Display Name<input v-model="state.draft.displayName" placeholder="Friendly name" /></label>
					<label>URL<input v-model="state.draft.url" placeholder="https://example.com" /></label>
					<div>
						<button type="button" :disabled="!state.draft.url || !state.draft.displayName" @click="store.add">
							<ModelHubHeroIconComponent name="PlusCircle" :size="16" />Add Link
						</button>
					</div>
				</div>
			</div>
			<div class="hub-between hub-links__manage">
				<h3>Manage Existing Links</h3>
				<div class="hub-inline">
					<a :href="url" target="_blank" rel="noopener noreferrer" title="Open Public Model Hub"
						>Public Model Hub<ModelHubHeroIconComponent name="ExternalLink" :size="16"
					/></a>
					<button v-if="!state.rearranging" type="button" @click="store.rearrange">Rearrange Order</button>
					<template v-else
						><button type="button" class="hub-links__save" @click="store.saveOrder">Save Order</button
						><button type="button" class="hub-links__cancel" @click="store.cancelOrder">Cancel</button></template
					>
				</div>
			</div>
			<div class="hub-links__table">
				<table>
					<thead>
						<tr>
							<th>Display Name</th>
							<th>URL</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(link, index) in state.links" :key="link.id">
							<template v-if="state.editing?.id === link.id"
								><td><input v-model="state.editing.displayName" aria-label="Edit display name" /></td>
								<td><input v-model="state.editing.url" aria-label="Edit URL" /></td>
								<td>
									<div class="hub-inline">
										<button type="button" class="hub-links__edit-save" @click="store.update">Save</button
										><button type="button" class="hub-links__edit-cancel" @click="state.editing = null">Cancel</button>
									</div>
								</td></template
							>
							<template v-else
								><td class="hub-links__name">{{ link.displayName }}</td>
								<td>{{ link.url }}</td>
								<td>
									<div class="hub-inline">
										<template v-if="state.rearranging"
											><UiTooltip :title="index === 0 ? 'Already at the top' : 'Move up'"
												><button
													type="button"
													class="hub-links__action"
													:disabled="index === 0"
													:aria-label="'Move up ' + link.displayName"
													:data-testid="'move-up-' + link.id"
													@click="store.move(index, -1)"
												>
													<ModelHubHeroIconComponent name="ChevronUp" :size="16" /></button></UiTooltip
											><UiTooltip :title="index === state.links.length - 1 ? 'Already at the bottom' : 'Move down'"
												><button
													type="button"
													class="hub-links__action"
													:disabled="index === state.links.length - 1"
													:aria-label="'Move down ' + link.displayName"
													:data-testid="'move-down-' + link.id"
													@click="store.move(index, 1)"
												>
													<ModelHubHeroIconComponent name="ChevronDown" :size="16" /></button></UiTooltip
										></template>
										<template v-else
											><UiTooltip title="Open link"
												><button
													type="button"
													class="hub-links__action"
													:aria-label="'Open ' + link.displayName"
													:data-testid="'open-link-' + link.id"
													@click="open(link.url)"
												>
													<ModelHubHeroIconComponent name="ExternalLink" :size="16" /></button></UiTooltip
											><UiTooltip title="Edit link"
												><button
													type="button"
													class="hub-links__action"
													:aria-label="'Edit ' + link.displayName"
													:data-testid="'edit-link-' + link.id"
													@click="store.edit(link)"
												>
													<ModelHubHeroIconComponent name="PencilAlt" :size="16" /></button></UiTooltip
											><UiTooltip title="Delete link"
												><button
													type="button"
													class="hub-links__action"
													:aria-label="'Delete ' + link.displayName"
													:data-testid="'delete-link-' + link.id"
													@click="store.remove(link.id)"
												>
													<ModelHubHeroIconComponent name="Trash" :size="16" /></button></UiTooltip
										></template>
									</div></td
							></template>
						</tr>
						<tr v-if="!state.links.length">
							<td colspan="3" class="hub-links__empty">No links added yet. Add a new link above.</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</UiCard>
</template>
<style>
.hub-links {
	margin-bottom: 24px;
}
.hub-links > .ui-card__body > header {
	cursor: pointer;
}
.hub-links h2 {
	font-size: 16.4px;
	line-height: 26.4px;
	font-weight: 500;
	color: #111827;
	margin: 0;
}
.hub-links header p {
	font-size: 14px;
	line-height: 20px;
	color: #6b7280;
}
.hub-links header > div:first-child {
	display: flex;
	flex-direction: column;
}
.hub-links__toggle {
	display: flex;
	align-items: center;
}
.hub-links .hub-hero-icon {
	flex-shrink: 1;
}
.hub-links__toggle > .hub-hero-icon {
	color: #6b7280;
	flex-shrink: 1;
}
.hub-links__content {
	margin-top: 16px;
}
.hub-links h3 {
	font-size: 14px;
	line-height: 20px;
	font-weight: 500;
	color: #374151;
	margin: 0 0 8px;
}
.hub-links__add {
	margin-bottom: 24px;
}
.hub-links__add > div {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 16px;
}
.hub-links__add label {
	display: block;
	font-size: 12px;
	line-height: 16px;
	color: #6b7280;
}
.hub-links input {
	width: 100%;
	padding: 8px 12px;
	border: 1px solid #d1d5db;
	border-radius: 6px;
	font: 14px/20px var(--ui-font-sans);
	background: #fff;
	color: #000;
}
.hub-links input::placeholder {
	color: #6b7280;
}
.hub-links__add input {
	display: block;
	margin-top: 4px;
}
.hub-links__add > div > div {
	display: flex;
	align-items: flex-end;
}
.hub-links__add button {
	display: flex;
	align-items: center;
	gap: 4px;
	background: #16a34a;
	color: #fff;
	border: 0;
	border-radius: 6px;
	padding: 8px 16px;
	font: 14px/20px var(--ui-font-sans);
}
.hub-links__add button:disabled {
	background: #d1d5db;
	color: #6b7280;
	cursor: not-allowed;
}
.hub-links__manage {
	margin-bottom: 8px;
}
.hub-links__manage h3 {
	margin: 0;
}
.hub-links__manage a,
.hub-links__manage button,
.hub-links__edit-save,
.hub-links__cancel {
	display: flex;
	align-items: center;
	gap: 4px;
	border: 0;
	border-radius: 4px;
	padding: 6px 12px;
	background: #faf5ff;
	color: #9333ea;
	font-size: 12px;
	line-height: 16px;
	cursor: pointer;
	text-decoration: none;
}
.hub-links__manage a,
.hub-links__edit-save {
	background: #eff6ff;
	color: #2563eb;
}
.hub-links button.hub-links__save {
	background: #16a34a;
	color: #fff;
}
.hub-links button.hub-links__cancel {
	background: #f9fafb;
	color: #4b5563;
}
.hub-links button.hub-links__edit-save,
.hub-links button.hub-links__edit-cancel {
	padding: 4px 8px;
}
.hub-links button.hub-links__edit-cancel {
	background: #f9fafb;
	color: #4b5563;
}
.hub-links__table {
	border: 1px solid #dcddeb;
	border-radius: 8px;
	overflow-x: auto;
}
.hub-links table {
	width: 100%;
	border-collapse: collapse;
	font-size: 14px;
	line-height: 20px;
	color: #6b7280;
	text-align: left;
}
.hub-links th {
	font-size: 12.4px;
	line-height: 18.4px;
	font-weight: 600;
	height: 32px;
	padding: 4px 16px;
	color: #111827;
	white-space: nowrap;
	border: 0;
}
.hub-links td {
	padding: 2px 16px;
	border: 0;
	white-space: nowrap;
	vertical-align: middle;
}
.hub-links tbody tr + tr {
	border-top: 1px solid #e5e7eb;
}
.hub-links td input {
	padding: 4px 8px;
}
.hub-links__name {
	color: #111827;
}
.hub-links__table td.hub-links__empty {
	text-align: center;
}
.hub-links .hub-links__action {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0;
	border: 0;
	background: transparent;
	color: #6366f1;
	cursor: pointer;
}
.hub-links .hub-links__action:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
.hub-links .hub-links__action:hover:enabled {
	color: #2563eb;
}
</style>
