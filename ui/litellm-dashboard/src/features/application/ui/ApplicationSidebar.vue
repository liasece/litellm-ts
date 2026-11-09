<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import ApplicationCollapsedAccess from "./ApplicationCollapsedAccessComponent.vue";
import ApplicationNavigationArrow from "./ApplicationNavigationArrowComponent.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { useBrowserPreferences } from "../stores/BrowserPreferencesStore";
import ApplicationUsageIndicator from "../usage-indicator/ui/ApplicationUsageIndicatorComponent.vue";
import { useApplicationStore } from "../stores/ApplicationStore";
import { dashboardHref, visibleNavigation } from "../logic/NavigationLogic";
import { navigationGroups } from "../data/NavigationData";

const props = defineProps<{ page: string; collapsed: boolean; uiBase: string }>();
const emit = defineEmits<{ navigate: [] }>();
const router = useRouter();
const auth = useAuthenticationStore();
const application = useApplicationStore();
const accessOpen = ref(false);
const { preferences } = useBrowserPreferences();
const selectedPage = computed(() =>
	navigationGroups.some((group) => group.items.some((item) => item.page === props.page)) ? props.page : "api-keys",
);
const isOrganizationAdmin = computed(() =>
	application.state.organizations.some((organization) =>
		organization.members?.some((member) => member.user_id === auth.state.session?.user_id && member.user_role === "org_admin"),
	),
);
const groups = computed(() =>
	visibleNavigation({
		role: auth.userRole.value,
		isOrganizationAdmin: isOrganizationAdmin.value,
		enabledInternalPages: application.state.settings.enabled_ui_pages_internal_users ?? null,
	}),
);
function navigate(event: MouseEvent, page: string): void {
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
	event.preventDefault();
	emit("navigate");
	void router.push(dashboardHref(page, props.uiBase));
}
</script>

<template>
	<div class="application-sidebar-content">
		<div class="application-sidebar-menu" :class="{ 'application-sidebar-menu--collapsed': collapsed }">
			<template v-for="group in groups" :key="group.label">
				<section class="application-navigation-group">
					<ApplicationCollapsedAccess
						v-if="group.collapsible && collapsed"
						:items="group.items"
						:ui-base="uiBase"
						:selected-page="selectedPage"
						@navigate="navigate"
					/>
					<button
						v-else-if="group.collapsible"
						type="button"
						class="application-navigation-heading application-navigation-heading--collapsible"
						:aria-expanded="accessOpen"
						:aria-label="group.label"
						@click="accessOpen = !accessOpen"
					>
						<span v-if="!collapsed">{{ group.label }}</span>
						<ApplicationNavigationArrow
							v-if="!collapsed"
							:expanded="accessOpen"
							:selected="group.items.some((item) => item.page === selectedPage)"
						/>
						<UiIcon v-else name="TeamOutlined" :size="15" />
					</button>
					<div v-else class="application-navigation-heading">
						<span v-if="!collapsed">{{ group.label }}</span>
					</div>
					<div
						v-if="!group.collapsible || (!collapsed && accessOpen)"
						class="application-navigation-items"
						:class="{ 'application-navigation-items--nested': group.collapsible }"
					>
						<a
							v-for="item in group.items"
							:key="item.page"
							:href="dashboardHref(item.page, uiBase)"
							class="application-navigation-item"
							:class="{ 'application-navigation-item--selected': selectedPage === item.page }"
							:aria-current="selectedPage === item.page ? 'page' : undefined"
							:title="collapsed ? item.label : undefined"
							@click="navigate($event, item.page)"
						>
							<UiIcon :name="item.icon" :size="collapsed ? 16 : 15" />
							<span v-if="!collapsed" class="application-navigation-label">{{ item.label }}</span>
							<span v-if="!collapsed && item.badge && !preferences.disableShowNewBadge" class="application-new-badge">{{
								item.badge
							}}</span>
						</a>
					</div>
				</section>
			</template>
		</div>
		<ApplicationUsageIndicator
			v-if="!collapsed && ['Admin', 'Admin Viewer', 'proxy_admin', 'proxy_admin_viewer', 'org_admin'].includes(auth.userRole.value)"
		/>
	</div>
</template>
