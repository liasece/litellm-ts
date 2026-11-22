import { defineAsyncComponent, type Component } from "vue";

const modules = import.meta.glob<{ default: Component }>("../../*/ui/*Page*.vue");
const views: Readonly<Record<string, string>> = {
	login: "../../identity/ui/LoginPage.vue",
	"subscription-runtime": "../../subscriptions/ui/SubscriptionRuntimePageComponent.vue",
	subscriptions: "../../subscriptions/ui/SubscriptionsPageComponent.vue",
	"api-keys": "../../virtual-keys/ui/VirtualKeysPageComponent.vue",
	models: "../../models/ui/ModelsPageComponent.vue",
	"models-credentials": "../../models/ui/ModelsPageComponent.vue",
	"models-retries": "../../models/ui/ModelsPageComponent.vue",
	"models-aliases": "../../models/ui/ModelsPageComponent.vue",
	"models-prices": "../../models/ui/ModelsPageComponent.vue",
	new_usage: "../../usage/ui/UsagePageComponent.vue",
	"usage-models": "../../usage/ui/UsagePageComponent.vue",
	"usage-keys": "../../usage/ui/UsagePageComponent.vue",
	"usage-endpoints": "../../usage/ui/UsagePageComponent.vue",
	"usage-accounts": "../../usage/ui/UsagePageComponent.vue",
	"usage-quota": "../../usage/ui/UsagePageComponent.vue",
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
	"admin-panel": "../../settings/ui/AdminSettingsPageComponent.vue",
	"ui-theme": "../../settings/ui/UiThemePageComponent.vue",
	"api-reference": "../../api-reference/ui/ApiReferencePageComponent.vue",
};
const components = new Map<string, Component>();
/**
 * 同一业务的多个页面（模型管理、用量统计的各分区）共用同一个组件文件，
 * 缓存必须按文件路径而不是页面 id：否则页面 id 变化会换出新的包装组件，
 * `<component :is>` 判定为不同类型而重建实例，切分区时丢掉已加载的数据与筛选条件。
 */
export function pageComponent(page: string): Component {
	const path = views[page];
	if (path === undefined) throw new Error("Vue migration page is not implemented: " + page);
	const cached = components.get(path);
	if (cached) return cached;
	const module = modules[path];
	if (!module) throw new Error("Vue migration page is not implemented: " + page);
	const component = defineAsyncComponent(module);
	components.set(path, component);
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
