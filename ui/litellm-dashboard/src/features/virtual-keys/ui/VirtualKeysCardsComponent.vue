<script setup lang="ts">
import { computed } from "vue";
import { copyText } from "../../content/logic/ClipboardLogic";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import { useMoneyFormatter } from "../../platform/stores/PriceDisplayStore";
import { keyDate } from "../render/KeyTablePresentation";
import type { KeyCatalog, VirtualKey } from "../support/VirtualKeyModels";
import KeyUserCell from "./KeyUserCellComponent.vue";

const props = withDefaults(
	defineProps<{
		rows: readonly VirtualKey[];
		catalog: KeyCatalog;
		loading: boolean;
		emptyText: string;
		pendingToken?: string;
		canModify?: (key: VirtualKey) => boolean;
	}>(),
	{ pendingToken: "", canModify: () => false },
);
const emit = defineEmits<{ select: [key: VirtualKey]; toggleEnabled: [key: VirtualKey, enabled: boolean] }>();
const formatMoney = useMoneyFormatter();
const hasRows = computed(() => props.rows.length > 0);
function teamName(key: VirtualKey): string {
	const id = key.team_id;
	if (!id) return "-";
	return props.catalog.teams.find((team) => team.team_id === id)?.team_alias || id;
}
function organizationName(key: VirtualKey): string {
	const id = key.org_id ?? key.organization_id;
	if (!id) return "-";
	return props.catalog.organizations.find((org) => org.organization_id === id)?.organization_alias || id;
}
function budget(key: VirtualKey): string {
	return key.max_budget === null || key.max_budget === undefined ? "Unlimited" : formatMoney(key.max_budget, 4);
}
function spend(key: VirtualKey): string {
	return formatMoney(key.spend ?? 0, 4);
}
function alias(key: VirtualKey): string {
	return key.key_alias || key.key_name || "Untitled key";
}
function modelsText(key: VirtualKey): string {
	const models = key.models ?? [];
	return models.length ? models.join(" · ") : "All Proxy Models";
}
function lastActive(key: VirtualKey): string {
	return key.last_active ? keyDate(key.last_active, "Unknown") : "Unknown";
}
function copyToken(key: VirtualKey): void {
	void copyText(key.token).catch(() => undefined);
}
</script>

<template>
	<div v-if="loading" class="vk-cards-state">Loading keys...</div>
	<div v-else-if="!hasRows" class="vk-cards-state">{{ emptyText }}</div>
	<ul v-else class="vk-cards">
		<li v-for="key in rows" :key="key.token" class="vk-card" @click="emit('select', key)">
			<div class="vk-card__head">
				<div class="vk-card__identity">
					<span class="vk-card__alias" :title="alias(key)">{{ alias(key) }}</span>
					<span class="vk-card__id" :title="key.token">{{ key.token || "-" }}</span>
				</div>
				<div class="vk-card__status" @click.stop>
					<UiSwitch
						:model-value="key.blocked !== true"
						:label="'Enabled ' + (key.key_alias || key.token)"
						:loading="pendingToken === key.token"
						:disabled="Boolean(pendingToken) || !canModify(key)"
						@update:model-value="emit('toggleEnabled', key, $event)"
						>{{ key.blocked === true ? "Disabled" : "Enabled" }}</UiSwitch
					>
				</div>
			</div>
			<dl class="vk-card__facts">
				<div class="vk-card__fact">
					<dt>User</dt>
					<dd>
						<KeyUserCell
							:user-id="key.user_id"
							:user-alias="key.user?.user_alias"
							:user-email="key.user?.user_email ?? key.user_email"
						/>
					</dd>
				</div>
				<div class="vk-card__fact">
					<dt>Spend</dt>
					<dd class="vk-card__money">
						{{ spend(key) }} <span class="vk-card__budget">of {{ budget(key) }}</span>
					</dd>
				</div>
				<div class="vk-card__fact">
					<dt>Team</dt>
					<dd class="vk-card__ellipsis" :title="teamName(key)">{{ teamName(key) }}</dd>
				</div>
				<div class="vk-card__fact">
					<dt>Org</dt>
					<dd class="vk-card__ellipsis" :title="organizationName(key)">{{ organizationName(key) }}</dd>
				</div>
				<div class="vk-card__fact vk-card__fact--wide">
					<dt>Models</dt>
					<dd class="vk-card__ellipsis" :title="modelsText(key)">{{ modelsText(key) }}</dd>
				</div>
			</dl>
			<div class="vk-card__foot">
				<span class="vk-card__meta">Created {{ keyDate(key.created_at, "-") }}</span>
				<span class="vk-card__meta">Active {{ lastActive(key) }}</span>
				<button
					type="button"
					class="vk-card__copy"
					aria-label="Copy Key"
					:title="'Copy Key ' + (key.token || '')"
					@click.stop="copyToken(key)"
				>
					<UiIcon name="CopyOutlined" :size="14" /><span>Copy Key</span>
				</button>
			</div>
		</li>
	</ul>
</template>
