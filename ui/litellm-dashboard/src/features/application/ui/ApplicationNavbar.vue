<script setup lang="ts">
import { computed } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { clearStoredReturnUrl } from "../../identity/logic/ReturnUrlLogic";
import { getApiBaseUrl, getServerRootPath } from "../../platform/api/HttpApiClient";
import UiSelect from "../../platform/ui/UiSelect.vue";
import { createSessionNavigation } from "../logic/ApplicationSessionNavigationLogic";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useApplicationStore } from "../stores/ApplicationStore";
import ApplicationBrandLogo from "./ApplicationBrandLogo.vue";
import ApplicationUserMenu from "./ApplicationUserMenu.vue";

defineProps<{ collapsed: boolean; mobileOpen: boolean; publicPage?: boolean }>();
defineEmits<{ toggleSidebar: []; toggleMobile: [] }>();
const auth = useAuthenticationStore();
const application = useApplicationStore();
const navigation = createSessionNavigation({
	logout: auth.logout,
	disconnectWorker: auth.disconnectWorker,
	clearReturnUrl: clearStoredReturnUrl,
	navigate: (url) => window.location.assign(url),
	logoutUrl: () => application.state.proxySettings.PROXY_LOGOUT_URL,
	uiBase: () => {
		const root = (auth.state.config?.server_root_path ?? getServerRootPath()).replace(/\/+$/, "");
		return (root === "/" ? "" : root) + "/ui";
	},
});
const workerOptions = computed(
	() =>
		auth.state.config?.workers?.map((worker) => ({
			label: worker.name,
			value: worker.worker_id,
			disabled: worker.worker_id === auth.state.selectedWorkerId,
		})) ?? [],
);
function switchWorker(value: unknown): void {
	if (typeof value === "string" && workerOptions.value.some((worker) => worker.value === value && !worker.disabled))
		void navigation.switchWorker(value);
}
</script>

<template>
	<nav class="application-navbar">
		<div class="application-navbar-inner">
			<div class="application-navbar-brand-group">
				<button
					v-if="!publicPage"
					type="button"
					class="application-mobile-menu-button"
					:title="mobileOpen ? 'Close navigation' : 'Open navigation'"
					:aria-label="mobileOpen ? 'Close navigation' : 'Open navigation'"
					:aria-expanded="mobileOpen"
					aria-controls="dashboard-mobile-navigation"
					@click="$emit('toggleMobile')"
				>
					<UiIcon :name="mobileOpen ? 'MenuFoldOutlined' : 'MenuUnfoldOutlined'" :size="18" />
				</button>
				<button
					v-if="!publicPage"
					type="button"
					class="application-desktop-menu-button"
					:title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
					:aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
					@click="$emit('toggleSidebar')"
				>
					<UiIcon :name="collapsed ? 'MenuUnfoldOutlined' : 'MenuFoldOutlined'" :size="18" />
				</button>
				<a :href="getApiBaseUrl() || '/'" class="application-navbar-brand"
					><span class="application-navbar-brand-relative"
						><span class="application-navbar-brand-image-box"><ApplicationBrandLogo /></span></span
				></a>
			</div>
			<div class="application-navbar-actions">
				<UiSelect
					v-if="auth.state.config?.is_control_plane && auth.state.selectedWorkerId"
					class="application-worker-select"
					:model-value="auth.state.selectedWorkerId"
					:options="workerOptions"
					searchable
					aria-label="Worker"
					@update:model-value="switchWorker"
					><template #suffix><UiIcon name="CloudServerOutlined" /></template
				></UiSelect>
				<a
					class="application-navbar-text-button application-docs-link"
					href="https://docs.litellm.ai/docs/"
					target="_blank"
					rel="noopener noreferrer"
					>Docs</a
				>
				<ApplicationUserMenu v-if="!publicPage" @logout="navigation.logout" />
			</div>
		</div>
	</nav>
</template>
