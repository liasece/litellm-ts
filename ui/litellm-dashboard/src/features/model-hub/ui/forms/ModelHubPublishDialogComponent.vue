<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { HubAgent, HubMcp, HubModel, HubPublishItem, HubPublishKind } from "../../support/ModelHubModels";
import { publishAgents, publishMcp, publishModels } from "../../logic/ModelHubPublishLogic";
import { createModelHubPublishStore } from "../../stores/ModelHubPublishStore";
import ModelHubModelFiltersComponent from "../filters/ModelHubModelFiltersComponent.vue";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiCheckbox from "../../../platform/ui/UiCheckbox.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
const props = defineProps<{ open: boolean; kind: HubPublishKind; models: HubModel[]; agents: HubAgent[]; servers: HubMcp[] }>(),
	emit = defineEmits<{ "update:open": [boolean]; success: [] }>(),
	items = computed(() =>
		props.kind === "models"
			? publishModels(props.models)
			: props.kind === "agents"
				? publishAgents(props.agents)
				: publishMcp(props.servers),
	),
	filtered = ref<HubModel[]>(props.models),
	store = createModelHubPublishStore(
		props.kind,
		() => items.value,
		() => emit("update:open", false),
		() => emit("success"),
	),
	state = store.state,
	visibleItems = computed(() => (props.kind === "models" ? publishModels(filtered.value) : items.value)),
	all = computed(() => visibleItems.value.length > 0 && visibleItems.value.every((item) => state.selected.has(item.id))),
	indeterminate = computed(() => state.selected.size > 0 && !all.value),
	selectedNoun = computed(() => (state.selected.size === 1 ? store.text.singular : store.text.plural));
watch(
	[() => props.open, items],
	([open]) => {
		if (open) {
			state.step = 0;
			store.initialize();
		}
	},
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
function mainBadges(item: HubPublishItem) {
	return props.kind === "models"
		? item.badges.filter((badge) => badge.color === "green")
		: props.kind === "agents"
			? item.badges.slice(0, 1)
			: item.badges.filter((badge) => badge.color !== "purple");
}
function confirmationBadges(item: HubPublishItem) {
	return mainBadges(item).filter((badge) => props.kind !== "mcp" || badge.label !== "Public");
}
function extraBadges(item: HubPublishItem) {
	return props.kind === "models"
		? item.badges.filter((badge) => badge.color !== "green")
		: props.kind === "agents"
			? item.badges.slice(1)
			: item.badges.filter((badge) => badge.color === "purple");
}
</script>
<template>
	<UiDialog
		:open="open"
		:title="'Make ' + store.text.title + ' Public'"
		:width="1200"
		:show-footer="false"
		:mask-closable="false"
		scroll-mode="overlay"
		class="hub-publish"
		@update:open="!$event && store.reset()"
	>
		<div class="hub-publish__steps">
			<div :class="{ 'is-finished': state.step > 0, 'is-current': state.step === 0 }">
				<span><UiIcon v-if="state.step > 0" name="CheckOutlined" /><template v-else>1</template></span
				><strong>{{ store.text.select }}</strong
				><i />
			</div>
			<div :class="{ 'is-current': state.step === 1 }"><span>2</span><strong>Confirm</strong></div>
		</div>
		<div v-if="state.step === 0" class="hub-publish__body">
			<div class="hub-between">
				<h3>Select {{ store.text.title }} to Make Public</h3>
				<UiCheckbox
					:model-value="all"
					:indeterminate="indeterminate"
					:disabled="!visibleItems.length"
					@update:model-value="store.selectAll(visibleItems, $event)"
					>Select All <template v-if="visibleItems.length">({{ visibleItems.length }})</template></UiCheckbox
				>
			</div>
			<p>
				Select the {{ store.text.plural }} you want to be visible on the public model hub. Users will still require a valid Virtual
				Key to use these {{ store.text.plural }}.
			</p>
			<ModelHubModelFiltersComponent v-if="kind === 'models'" :models="models" :card="false" @change="filtered = $event" />
			<div class="hub-publish__selection">
				<p v-if="!visibleItems.length" class="hub-publish__empty">{{ store.text.empty }}</p>
				<div v-for="item in visibleItems" :key="item.id" class="hub-publish__item">
					<UiCheckbox
						:model-value="state.selected.has(item.id)"
						:aria-label="'Select ' + item.name"
						@update:model-value="store.toggle(item.id, $event)"
					/>
					<div>
						<div class="hub-inline">
							<strong>{{ item.name }}</strong
							><ModelHubBadgeComponent
								v-for="(badge, index) in mainBadges(item)"
								:key="index"
								:color="badge.color"
								size="sm"
								>{{ badge.label }}</ModelHubBadgeComponent
							>
						</div>
						<p v-if="item.description">{{ item.description }}</p>
						<div v-if="extraBadges(item).length" class="hub-tags">
							<ModelHubBadgeComponent
								v-for="(badge, index) in extraBadges(item)"
								:key="index"
								:color="badge.color"
								size="xs"
								>{{ badge.label }}</ModelHubBadgeComponent
							><span v-if="item.extra">{{ item.extra }}</span>
						</div>
					</div>
				</div>
			</div>
			<div v-if="state.selected.size" class="hub-publish__info">
				<strong>{{ state.selected.size }}</strong> {{ selectedNoun }} selected
			</div>
		</div>
		<div v-else class="hub-publish__body">
			<h3>Confirm Making {{ store.text.title }} Public</h3>
			<div class="hub-publish__warning">
				<strong>Warning:</strong> Once you make these {{ store.text.plural }} public, anyone who can go to the
				<code>/ui/model_hub_table</code> will be able to know they exist on the proxy.
			</div>
			<div>
				<p class="hub-publish__label">{{ store.text.title }} to be made public:</p>
				<div class="hub-publish__confirm">
					<div v-for="item in store.selected.value" :key="item.id">
						<div>
							<div class="hub-inline">
								<strong>{{ item.name }}</strong
								><ModelHubBadgeComponent
									v-for="(badge, index) in kind === 'models' ? [] : confirmationBadges(item)"
									:key="index"
									:color="badge.color"
									size="xs"
									>{{ badge.label }}</ModelHubBadgeComponent
								>
							</div>
							<p v-if="kind === 'mcp' ? item.confirmationDescription : item.description">
								{{ kind === "mcp" ? item.confirmationDescription : item.description }}
							</p>
							<p v-if="kind === 'mcp' && item.url" class="hub-publish__url">{{ item.url }}</p>
							<div v-if="kind === 'models'" class="hub-tags hub-mt-4">
								<ModelHubBadgeComponent
									v-for="(badge, index) in extraBadges(item)"
									:key="index"
									:color="badge.color"
									size="xs"
									>{{ badge.label }}</ModelHubBadgeComponent
								>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="hub-publish__info">
				Total: <strong>{{ state.selected.size }}</strong> {{ selectedNoun }} will be made public
			</div>
		</div>
		<footer class="hub-between">
			<UiButton @click="state.step === 0 ? store.reset() : (state.step = 0)">{{ state.step === 0 ? "Cancel" : "Previous" }}</UiButton
			><UiButton v-if="state.step === 0" :disabled="!state.selected.size" @click="store.next">Next</UiButton
			><UiButton v-else :loading="state.loading" @click="store.submit">Make Public</UiButton>
		</footer>
	</UiDialog>
</template>
<style>
.hub-publish__steps {
	display: flex;
	gap: 16px;
	margin-bottom: 24px;
	font: 14px/22px var(--ui-font-antd);
}
.hub-publish__steps > div {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: 1;
	color: #00000073;
}
.hub-publish__steps > div:last-child {
	flex: 0 0 auto;
}
.hub-publish__steps strong {
	font-weight: 400;
	font-size: 16px;
	white-space: nowrap;
}
.hub-publish__steps > div > span {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 32px;
	height: 32px;
	border: 1px solid rgba(5, 5, 5, 0.06);
	border-radius: 50%;
	background: #0000000f;
	color: #00000073;
}
.hub-publish__steps i {
	height: 1px;
	background: #0000000f;
	flex: 1;
	margin-left: 8px;
}
.hub-publish__steps .is-current {
	color: #000000e0;
}
.hub-publish__steps .is-current strong {
	font-weight: 400;
}
.hub-publish__steps .is-finished {
	color: #000000e0;
}
.hub-publish__steps .is-current > span {
	background: #1677ff;
	border-color: #1677ff;
	color: #fff;
}
.hub-publish__steps .is-finished > span {
	background: #e6f4ff;
	border-color: #e6f4ff;
	color: #1677ff;
}
.hub-publish__steps .is-finished i {
	background: #1677ff;
}
.hub-publish .ui-checkbox {
	color: #1f1f1f;
}
.hub-publish__body {
	display: flex;
	flex-direction: column;
	gap: 16px;
	font-family: var(--ui-font-antd);
	color: #6b7280;
	font-size: 12.4px;
	line-height: 18.4px;
}
.hub-publish__body h3 {
	font-size: 16.4px;
	line-height: 26.4px;
	font-weight: 500;
	color: #111827;
	margin: 0;
}
.hub-publish__body p {
	margin: 0;
}
.hub-publish__body > p,
.hub-publish__item p,
.hub-publish__confirm p {
	color: #4b5563;
}
.hub-publish__selection {
	max-height: 384px;
	overflow-y: auto;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	padding: 16px;
}
.hub-publish__empty {
	text-align: center;
	padding: 32px 0;
	color: #6b7280;
}
.hub-publish__item {
	display: flex;
	gap: 12px;
	align-items: center;
	padding: 12px;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	margin-top: 12px;
}
.hub-publish__item:first-child {
	margin-top: 0;
}
.hub-publish__item:hover {
	background: #f9fafb;
}
.hub-publish__item > div:last-child {
	flex: 1;
}
.hub-publish__item p {
	font-size: 12px;
	line-height: 16px;
	margin-top: 4px;
}
.hub-publish__item .hub-tags {
	margin-top: 4px;
}
.hub-publish__info {
	padding: 12px;
	background: #eff6ff;
	border: 1px solid #bfdbfe;
	border-radius: 8px;
	color: #1e40af;
}
.hub-publish__warning {
	padding: 16px;
	background: #fefce8;
	border: 1px solid #fef08a;
	border-radius: 8px;
	color: #854d0e;
}
.hub-publish__label {
	font-weight: 500;
	margin-bottom: 12px !important;
}
.hub-publish__confirm {
	max-height: 192px;
	overflow-y: auto;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	padding: 12px;
}
.hub-publish__confirm > div {
	padding: 8px;
	background: #f9fafb;
	border-radius: 4px;
	margin-top: 8px;
}
.hub-publish__confirm > div:first-child {
	margin-top: 0;
}
.hub-publish__confirm p {
	margin-top: 4px;
	font-size: 12px;
	line-height: 16px;
}
.hub-publish > .ui-dialog__body > footer {
	margin-top: 24px;
}
.hub-publish__body > p,
.hub-publish__info,
.hub-publish__warning {
	font-size: 14px;
	line-height: 20px;
}
.hub-publish__item strong,
.hub-publish__confirm strong {
	font-weight: 500;
}
.hub-publish__url {
	color: #6b7280;
}
@media (max-width: 532px) {
	.hub-publish__steps {
		flex-direction: column;
		gap: 0;
	}
	.hub-publish__steps > div,
	.hub-publish__steps > div:last-child {
		position: relative;
		flex: none;
		height: 48px;
		width: 100%;
		align-items: flex-start;
		gap: 16px;
	}
	.hub-publish__steps > div > span {
		flex-shrink: 0;
	}
	.hub-publish__steps strong {
		line-height: 32px;
	}
	.hub-publish__steps i {
		position: absolute;
		left: 15px;
		top: 38px;
		width: 1px;
		height: 4px;
		margin: 0;
	}
}
</style>
