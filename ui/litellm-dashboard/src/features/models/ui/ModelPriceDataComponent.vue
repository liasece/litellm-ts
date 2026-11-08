<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiInputNumber from "../../platform/ui/UiInputNumber.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { modelsApi } from "../api/ModelsApi";
import { modelString } from "../support/ModelModels";
import notification from "../../notifications/logic/NotificationManager";
defineEmits<{ reloaded: [] }>();
const status = ref<Record<string, unknown> | null>(null),
	source = ref<Record<string, unknown> | null>(null),
	hours = ref<number | null>(6),
	scheduleOpen = ref(false),
	pending = ref(false),
	scheduling = ref(false),
	cancelling = ref(false),
	confirmation = ref<InstanceType<typeof UiPopover>>();
const remote = computed(() => source.value?.source === "remote");
let disposed = false,
	timer: ReturnType<typeof setInterval> | undefined;
async function refresh() {
	const results = await Promise.allSettled([modelsApi.fetchPriceReloadStatus(), modelsApi.fetchPriceSource()]);
	if (disposed) return;
	status.value =
		results[0].status === "fulfilled" ? results[0].value : { scheduled: false, interval_hours: null, last_run: null, next_run: null };
	if (results[1].status === "fulfilled") source.value = results[1].value;
}
async function reload() {
	confirmation.value?.hide();
	pending.value = true;
	try {
		const response = await modelsApi.reloadPrices();
		if (response.status === "success") {
			notification.success("Price data reloaded successfully! " + Number(response.models_count || 0) + " models updated.");
			await refresh();
		} else notification.fromBackend("Failed to reload price data");
	} catch {
		notification.fromBackend("Failed to reload price data. Please try again.");
	} finally {
		pending.value = false;
	}
}
async function schedule() {
	if (!hours.value || hours.value <= 0) {
		notification.fromBackend("Hours must be greater than 0");
		return;
	}
	scheduling.value = true;
	try {
		const response = await modelsApi.schedulePriceReload(hours.value);
		if (response.status === "success") {
			notification.success("Periodic reload scheduled for every " + hours.value + " hours");
			scheduleOpen.value = false;
			await refresh();
		} else notification.fromBackend("Failed to schedule periodic reload");
	} catch {
		notification.fromBackend("Failed to schedule periodic reload. Please try again.");
	} finally {
		scheduling.value = false;
	}
}
async function cancel() {
	cancelling.value = true;
	try {
		const response = await modelsApi.cancelPriceReload();
		if (response.status === "success") {
			notification.success("Periodic reload cancelled successfully");
			await refresh();
		} else notification.fromBackend("Failed to cancel periodic reload");
	} catch {
		notification.fromBackend("Failed to cancel periodic reload. Please try again.");
	} finally {
		cancelling.value = false;
	}
}
function date(value: unknown) {
	if (!value) return "Never";
	try {
		return new Date(modelString(value)).toLocaleString();
	} catch {
		return modelString(value);
	}
}
onMounted(() => {
	void refresh();
	timer = setInterval(() => void refresh(), 30000);
});
onBeforeUnmount(() => {
	disposed = true;
	if (timer) clearInterval(timer);
});
</script>
<template>
	<div class="model-price-data">
		<h3 class="model-title">Price Data Management</h3>
		<p class="model-text model-price-subtitle">Manage model pricing data and configure automatic reload schedules</p>
		<div class="model-price-actions">
			<div class="model-price-action">
				<UiPopover ref="confirmation" trigger="click" placement="topLeft" popup-class="model-price-confirm"
					><UiButton class="model-price-primary" variant="primary" :loading="pending"
						><template #icon
							><span class="model-price-button-icon"
								><span><UiIcon name="ReloadOutlined" /></span></span></template
						>Reload Price Data</UiButton
					><template #content
						><div class="model-inline">
							<UiIcon name="ExclamationCircleFilled" class="model-warning" />
							<div>
								<strong>Hard Refresh Price Data</strong>
								<p>This will immediately fetch the latest pricing information from the remote source. Continue?</p>
							</div>
						</div>
						<div class="model-popconfirm-actions">
							<UiButton size="small" @click="confirmation?.hide()">No</UiButton
							><UiButton size="small" variant="primary" class="model-price-primary" @click="reload">Yes</UiButton>
						</div></template
					></UiPopover
				>
			</div>
			<div class="model-price-action">
				<UiButton v-if="!status?.scheduled" class="model-price-schedule" @click="scheduleOpen = true"
					><template #icon
						><span class="model-price-button-icon"
							><span><UiIcon name="ClockCircleOutlined" /></span></span></template
					>Set Up Periodic Reload</UiButton
				><UiButton v-else danger class="model-price-schedule" :loading="cancelling" @click="cancel"
					><template #icon
						><span class="model-price-button-icon"
							><span><UiIcon name="StopOutlined" /></span></span></template
					>Cancel Periodic Reload</UiButton
				>
			</div>
		</div>
		<section v-if="source" class="model-price-source" :class="remote ? 'model-price-source--remote' : 'model-price-source--local'">
			<header>
				<UiIcon :name="remote ? 'CloudOutlined' : 'DatabaseOutlined'" :size="16" /><strong>Pricing Data Source</strong
				><UiTag :color="remote ? 'blue' : 'orange'">{{ remote ? "Remote" : "Local" }}</UiTag>
			</header>
			<hr />
			<div class="model-price-row">
				<span>Models loaded:</span><strong>{{ Number(source.model_count ?? 0).toLocaleString() }}</strong>
			</div>
			<div v-if="source.url" class="model-price-row">
				<span>{{ remote ? "Loaded from:" : "Attempted URL:" }}</span
				><UiTooltip :title="modelString(source.url)"
					><span class="model-price-url">{{ source.url }}</span></UiTooltip
				>
			</div>
			<p v-if="source.is_env_forced" class="model-price-notice">
				<UiIcon name="InfoCircleOutlined" :size="12" />Local mode forced via <code>LITELLM_LOCAL_MODEL_COST_MAP=True</code>
			</p>
			<p v-if="source.fallback_reason" class="model-price-fallback">
				<UiIcon name="WarningOutlined" :size="12" />Fell back to local: {{ source.fallback_reason }}
			</p>
		</section>
		<section v-if="status" class="model-price-status">
			<UiTag v-if="status.scheduled" color="green"
				><UiIcon name="ClockCircleOutlined" />Scheduled every {{ status.interval_hours }} hours</UiTag
			>
			<p v-else>No periodic reload scheduled</p>
			<div class="model-price-row">
				<span>Last run:</span><span>{{ date(status.last_run) }}</span>
			</div>
			<template v-if="status.scheduled"
				><div v-if="status.next_run" class="model-price-row">
					<span>Next run:</span><span>{{ date(status.next_run) }}</span>
				</div>
				<div class="model-price-row">
					<span>Status:</span
					><UiTag :color="status.last_run ? 'success' : 'processing'">{{ status.last_run ? "Active" : "Ready" }}</UiTag>
				</div></template
			>
		</section>
		<UiDialog
			v-model:open="scheduleOpen"
			title="Set Up Periodic Reload"
			ok-text="Schedule"
			:confirm-loading="scheduling"
			scroll-mode="overlay"
			class="model-price-schedule-dialog"
			@ok="schedule"
			><p class="model-price-dialog-copy">Set up automatic reload of price data every:</p>
			<div class="model-number-addon">
				<UiInputNumber
					:model-value="hours"
					:min="1"
					:max="168"
					aria-label="Reload interval hours"
					@update:model-value="hours = $event || 6"
				/><span>hours</span>
			</div>
			<p class="model-price-dialog-help">
				This will automatically fetch the latest pricing data from the remote source every {{ hours }} hours.
			</p></UiDialog
		>
	</div>
</template>
