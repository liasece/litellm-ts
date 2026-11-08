<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import ApplicationNavbar from "./ApplicationNavbar.vue";
import ApplicationSidebar from "./ApplicationSidebar.vue";
import ApplicationDebugWarningBanner from "../health-readiness/ui/ApplicationDebugWarningBannerComponent.vue";
import "./ApplicationShellStyles.css";

defineProps<{ page: string; uiBase: string; showDebugBanner: boolean }>();
const collapsed = ref(false);
const mobileOpen = ref(false);
function closeOnEscape(event: KeyboardEvent): void {
	if (event.key === "Escape") mobileOpen.value = false;
}
onMounted(() => window.addEventListener("keydown", closeOnEscape));
onUnmounted(() => window.removeEventListener("keydown", closeOnEscape));
</script>

<template>
	<div class="application-shell" data-testid="dashboard-shell">
		<ApplicationNavbar
			:collapsed="collapsed"
			:mobile-open="mobileOpen"
			@toggle-sidebar="collapsed = !collapsed"
			@toggle-mobile="mobileOpen = !mobileOpen"
		/>
		<div v-if="showDebugBanner" class="application-debug-banner"><ApplicationDebugWarningBanner /></div>
		<div class="application-workspace" data-testid="dashboard-workspace">
			<button
				v-if="mobileOpen"
				type="button"
				class="application-navigation-overlay"
				aria-label="Dismiss navigation overlay"
				tabindex="-1"
				@click="mobileOpen = false"
			></button>
			<aside
				id="dashboard-mobile-navigation"
				class="application-sidebar"
				:class="{ 'application-sidebar--collapsed': collapsed, 'application-sidebar--mobile-open': mobileOpen }"
				aria-label="Dashboard navigation"
				data-testid="dashboard-sidebar-scroll"
			>
				<ApplicationSidebar :page="page" :collapsed="collapsed" :ui-base="uiBase" @navigate="mobileOpen = false" />
			</aside>
			<main class="application-main" data-testid="dashboard-main-scroll"><slot /></main>
		</div>
	</div>
</template>
