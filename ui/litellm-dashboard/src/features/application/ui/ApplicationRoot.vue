<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { authenticationStoreKey, createAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { buildLoginUrlWithReturn, consumeReturnUrl, normalizeUrlForCompare, storeReturnUrl } from "../../identity/logic/ReturnUrlLogic";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../platform/stores/PriceDisplayStore";
import { getServerRootPath } from "../../platform/api/HttpApiClient";
import { applicationStoreKey, createApplicationStore } from "../stores/ApplicationStore";
import { dashboardPageFromUrl } from "../logic/NavigationLogic";
import { isRegisteredPage, pageComponent } from "../data/PageRegistry";
import ApplicationBrandLogo from "./ApplicationBrandLogo.vue";
import ApplicationYamlConfigDiff from "./ApplicationYamlConfigDiffComponent.vue";
import ApplicationShell from "./ApplicationShell.vue";
import NotificationLayerComponent from "../../notifications/ui/NotificationLayerComponent.vue";
import MessageLayerComponent from "../../notifications/ui/MessageLayerComponent.vue";
import { applyConfiguredThemeFavicon } from "../logic/ThemeFaviconLogic";
import "./ApplicationShellStyles.css";

const auth = createAuthenticationStore();
const application = createApplicationStore();
const prices = createPriceDisplayStore();
provide(authenticationStoreKey, auth);
provide(applicationStoreKey, application);
provide(priceDisplayStoreKey, prices);
const router = useRouter();
const route = useRoute();
const uiBase = computed(() => {
	const root = (auth.state.config?.server_root_path ?? getServerRootPath()).replace(/\/+$/, "");
	return (root === "/" ? "" : root) + "/ui";
});
const page = computed(() => {
	const url = new URL(route.fullPath, window.location.origin);
	const id = dashboardPageFromUrl(url, uiBase.value);
	const resolved = id === "api-keys" && auth.userRole.value === "Admin Viewer" ? "new_usage" : id;
	return isRegisteredPage(resolved) ? resolved : "api-keys";
});
const legacyRoot = computed(() => route.path.replace(/\/+$/, "") === uiBase.value);
const standalone = computed(() => ["login", "chat"].includes(page.value));
const publicPage = computed(() => ["login"].includes(page.value));
const view = computed(() => (!auth.state.loading && (publicPage.value || auth.isAuthorized.value) ? pageComponent(page.value) : null));
watch(
	() => auth.state.session?.user_id ?? null,
	(userId) => {
		application.clear();
		if (userId) {
			void application.initialize();
			void prices.initialize();
		}
	},
);
watch([() => auth.state.loading, () => auth.isAuthorized.value, publicPage], ([loading, authorized, isPublic]) => {
	if (loading || authorized || isPublic) return;
	storeReturnUrl();
	void router.replace(buildLoginUrlWithReturn(uiBase.value + "/login"));
});
let attemptedReturnRedirect = false;
watch([() => auth.state.loading, () => auth.isAuthorized.value], ([loading, authorized]) => {
	if (!authorized) {
		attemptedReturnRedirect = false;
		return;
	}
	if (loading || publicPage.value || attemptedReturnRedirect) return;
	attemptedReturnRedirect = true;
	const destination = consumeReturnUrl();
	if (destination && normalizeUrlForCompare(destination) !== normalizeUrlForCompare(window.location.href))
		window.location.replace(destination);
});
onMounted(() => {
	void auth
		.initialize()
		.catch(() => undefined)
		.then(() => applyConfiguredThemeFavicon());
});
onUnmounted(() => {
	auth.dispose();
	prices.dispose();
	application.clear();
});
</script>

<template>
	<div v-if="auth.state.loading" class="application-loading-screen" role="status">
		<div class="application-loading-title"><ApplicationBrandLogo class="application-loading-logo" /></div>
		<span>Loading...</span>
	</div>
	<component :is="view" v-else-if="standalone && view" />
	<ApplicationShell v-else-if="view" :page="page" :ui-base="uiBase" :show-debug-banner="!legacyRoot"
		><component :is="view"
	/></ApplicationShell>
	<ApplicationYamlConfigDiff v-if="view && !standalone && legacyRoot" />
	<NotificationLayerComponent />
	<MessageLayerComponent />
</template>

<style>
.application-loading-screen {
	display: flex;
	height: 100dvh;
	align-items: center;
	justify-content: center;
	flex-direction: column;
	gap: 16px;
	background: #fff;
	color: #6b7280;
	font-size: 14px;
}
.application-loading-title {
	display: flex;
	justify-content: center;
}
.application-loading-logo {
	height: 48px;
	width: auto;
}
</style>
