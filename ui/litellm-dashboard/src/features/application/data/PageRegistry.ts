import { defineAsyncComponent, type Component } from "vue";

const modules = import.meta.glob<{ default: Component }>("../../*/ui/*Page*.vue");
const views: Readonly<Record<string, string>> = {
	login: "../../identity/ui/LoginPage.vue",
	onboarding: "../../identity/ui/OnboardingPage.vue",
	"mcp-oauth-callback": "../../identity/ui/McpOAuthCallbackPage.vue",
	cliproxy: "../../cliproxy/ui/CliProxyPageComponent.vue",
	"api-keys": "../../virtual-keys/ui/VirtualKeysPageComponent.vue",
	models: "../../models/ui/ModelsPageComponent.vue",
	new_usage: "../../usage/ui/UsagePageComponent.vue",
	logs: "../../logs/ui/LogsPageComponent.vue",
	speed: "../../speed/ui/SpeedPageComponent.vue",
	teams: "../../access-control/ui/TeamsPageComponent.vue",
	users: "../../access-control/ui/UsersPageComponent.vue",
	organizations: "../../access-control/ui/OrganizationsPageComponent.vue",
	projects: "../../access-control/ui/ProjectsPageComponent.vue",
	"access-groups": "../../access-control/ui/AccessGroupsPageComponent.vue",
	budgets: "../../access-control/ui/BudgetsPageComponent.vue",
	"model-hub-table": "../../model-hub/ui/ModelHubPageComponent.vue",
	"public-model-hub": "../../model-hub/ui/PublicModelHubPageComponent.vue",
	"llm-playground": "../../playground/ui/PlaygroundPageComponent.vue",
	chat: "../../playground/ui/ChatPageComponent.vue",
	"test-key": "../../playground/ui/TestKeyPageComponent.vue",
	"mcp-servers": "../../tools/ui/McpServersPageComponent.vue",
	"search-tools": "../../tools/ui/SearchToolsPageComponent.vue",
	"transform-request": "../../tools/ui/ApiPlaygroundPageComponent.vue",
	"tag-management": "../../tools/ui/TagManagementPageComponent.vue",
	"claude-code-plugins": "../../tools/ui/ClaudeCodePluginsPageComponent.vue",
	"vector-stores": "../../tools/ui/VectorStoresPageComponent.vue",
	agents: "../../tools/ui/AgentsPageComponent.vue",
	usage: "../../usage/ui/OldUsagePageComponent.vue",
	"builtin-capabilities": "../../settings/ui/BuiltinCapabilitiesPageComponent.vue",
	"router-settings": "../../settings/ui/RouterSettingsPageComponent.vue",
	"logging-and-alerts": "../../settings/ui/LoggingAndAlertsPageComponent.vue",
	"admin-panel": "../../settings/ui/AdminSettingsPageComponent.vue",
	"cost-tracking": "../../settings/ui/CostTrackingPageComponent.vue",
	"ui-theme": "../../settings/ui/UiThemePageComponent.vue",
	guardrails: "../../guardrails/ui/GuardrailsPageComponent.vue",
	policies: "../../guardrails/ui/PoliciesPageComponent.vue",
	"tool-policies": "../../guardrails/ui/ToolPoliciesPageComponent.vue",
	"guardrails-monitor": "../../guardrails/ui/GuardrailsMonitorPageComponent.vue",
	prompts: "../../prompts/ui/PromptsPageComponent.vue",
	caching: "../../settings/ui/CachePageComponent.vue",
	"pass-through-settings": "../../settings/ui/PassThroughSettingsPageComponent.vue",
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
export function pageImplementationStatus(): Array<{ page: string; implemented: boolean }> {
	return Object.entries(views).map(([page, path]) => ({ page, implemented: Boolean(modules[path]) }));
}
