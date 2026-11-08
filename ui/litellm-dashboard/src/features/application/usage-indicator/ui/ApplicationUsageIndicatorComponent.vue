<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from "vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { useBrowserPreferences } from "../../stores/BrowserPreferencesStore";
import { createApplicationUsageIndicatorStore } from "../stores/ApplicationUsageIndicatorStore";
import { usageTone, formatLicenseExpiration } from "../logic/ApplicationUsageLogic";
import ApplicationQuotaCardComponent from "./ApplicationQuotaCardComponent.vue";
import "../styles/ApplicationUsageIndicatorStyles.css";
const props = withDefaults(defineProps<{ collapsed?: boolean; width?: number }>(), { collapsed: false, width: 220 }),
	auth = useAuthenticationStore(),
	{ preferences } = useBrowserPreferences(),
	store = createApplicationUsageIndicatorStore(() => auth.isAuthorized.value),
	{ state, data, license, metrics } = store,
	hidden = computed(() => !auth.isAuthorized.value || Boolean(preferences.disableUsageIndicator)),
	licenseTone = computed(() => (metrics.value.expired ? "error" : metrics.value.expiring ? "warning" : "normal"));
watch(
	() => [auth.isAuthorized.value, auth.state.session?.user_id],
	() => void store.load(),
	{ immediate: true },
);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div v-if="!hidden && !props.collapsed" class="application-usage-indicator" :style="{ maxWidth: Math.min(props.width, 220) + 'px' }">
		<button
			v-if="state.minimized"
			type="button"
			class="application-usage-minimized"
			title="Show usage details"
			@click="state.minimized = false"
		>
			<div>
				<UiLucideIcon name="Users" :size="16" /><span v-if="metrics.hasIssue"
					><UiLucideIcon
						v-if="metrics.error || metrics.warning"
						:name="metrics.error ? 'AlertTriangle' : 'TrendingUp'"
						:size="12"
				/></span>
				<div>
					<span v-if="data" :class="'tone-' + usageTone(metrics.user)"
						>U: {{ data.total_users_used }}{{ data.total_users === null ? "" : "/" + data.total_users }}</span
					><span v-if="data" :class="'tone-' + usageTone(metrics.team)"
						>T: {{ data.total_teams_used }}{{ data.total_teams === null ? "" : "/" + data.total_teams }}</span
					><span v-if="license?.expiration_date && metrics.days !== null" :class="'tone-' + licenseTone">{{
						metrics.days < 0 ? "Exp!" : metrics.days + "d"
					}}</span
					><span v-if="!data && !state.loading" class="application-usage-fallback" :title="state.error || undefined">Usage</span>
				</div>
			</div>
		</button>
		<div v-else-if="state.loading" class="application-usage-loading">
			<UiLucideIcon name="Loader2" :size="16" /><span>Loading...</span>
		</div>
		<div v-else-if="state.error || !data" class="application-usage-error">
			<span>{{ state.error || "No data" }}</span
			><button type="button" title="Minimize" @click="state.minimized = true"><UiLucideIcon name="Minus" :size="12" /></button>
		</div>
		<div v-else class="application-usage-card">
			<header>
				<div><UiLucideIcon name="Users" :size="16" /><strong>Usage</strong></div>
				<button type="button" title="Minimize" @click="state.minimized = true"><UiLucideIcon name="Minus" :size="12" /></button>
			</header>
			<div>
				<section
					v-if="license?.has_license && license.expiration_date"
					:class="['application-usage-license', 'tone-' + licenseTone]"
				>
					<header>
						<UiLucideIcon name="Calendar" :size="12" /><strong>License</strong
						><span :class="'tone-' + licenseTone">{{
							metrics.expired ? "Expired" : metrics.expiring ? "Expiring soon" : "OK"
						}}</span>
					</header>
					<div>
						<span>Status:</span
						><strong :class="'quota-text-' + licenseTone">{{ formatLicenseExpiration(metrics.days) }}</strong>
					</div>
					<div v-if="license.license_type">
						<span>Type:</span><strong class="license-type">{{ license.license_type }}</strong>
					</div>
				</section>
				<ApplicationQuotaCardComponent
					kind="users"
					:total="data.total_users"
					:used="data.total_users_used"
					:remaining="data.total_users_remaining"
					:metrics="metrics.user"
				/><ApplicationQuotaCardComponent
					kind="teams"
					:total="data.total_teams"
					:used="data.total_teams_used"
					:remaining="data.total_teams_remaining"
					:metrics="metrics.team"
				/>
			</div>
		</div>
	</div>
</template>
