import { defineAsyncComponent, type Component } from "vue";

const modules = import.meta.glob<{ default: Component }>("../../*/ui/*Page*.vue");
const views: Readonly<Record<string, string>> = {
	login: "../../identity/ui/LoginPage.vue",
	cliproxy: "../../cliproxy/ui/CliProxyPageComponent.vue",
	subscriptions: "../../subscriptions/ui/SubscriptionsPageComponent.vue",
	"api-keys": "../../virtual-keys/ui/VirtualKeysPageComponent.vue",
	models: "../../models/ui/ModelsPageComponent.vue",
	new_usage: "../../usage/ui/UsagePageComponent.vue",
	logs: "../../logs/ui/LogsPageComponent.vue",
	speed: "../../speed/ui/SpeedPageComponent.vue",
	privacy: "../../privacy/ui/PrivacyPageComponent.vue",
	teams: "../../access-control/ui/TeamsPageComponent.vue",
	users: "../../access-control/ui/UsersPageComponent.vue",
	organizations: "../../access-control/ui/OrganizationsPageComponent.vue",
	"llm-playground": "../../playground/ui/PlaygroundPageComponent.vue",
	chat: "../../playground/ui/ChatPageComponent.vue",
	"test-key": "../../playground/ui/TestKeyPageComponent.vue",
	"search-tools": "../../tools/ui/SearchToolsPageComponent.vue",
	"builtin-capabilities": "../../settings/ui/BuiltinCapabilitiesPageComponent.vue",
	"router-settings": "../../settings/ui/RouterSettingsPageComponent.vue",
	"logging-and-alerts": "../../settings/ui/LoggingAndAlertsPageComponent.vue",
	"admin-panel": "../../settings/ui/AdminSettingsPageComponent.vue",
	"cost-tracking": "../../settings/ui/CostTrackingPageComponent.vue",
	"ui-theme": "../../settings/ui/UiThemePageComponent.vue",
	"api-reference": "../../api-reference/ui/ApiReferencePageComponent.vue",
};
const components = new Map<string, Component>();
export function pageComponent(page: string): Component {
	const cached = components.get(page);
	if (cached) return cached;
	const module = modules[views[page]];
	if (!module) throw new Error("Vue migration page is not implemented: " + page);
	const component = defineAsyncComponent(module);
	components.set(page, component);
	return component;
}

/**
 * Check whether a page id resolves to a built Vue page before routing to it.
 * @param page - Page id from the URL or a legacy `?page=` query.
 * @returns Whether the page is registered and present in the build.
 */
export function isRegisteredPage(page: string): boolean {
	const path = views[page];
	return path !== undefined && modules[path] !== undefined;
}
export function pageImplementationStatus(): Array<{ page: string; implemented: boolean }> {
	return Object.entries(views).map(([page, path]) => ({ page, implemented: Boolean(modules[path]) }));
}
