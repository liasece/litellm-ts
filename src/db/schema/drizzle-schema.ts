/**
 * Unified Drizzle Schema — exports ALL tables for Drizzle ORM.
 * This is the single source of truth for database migrations and queries.
 *
 * To use: `import * as schema from "./drizzle-schema"`
 * Then: `const db = drizzle(pool, { schema })`
 */

// ─── Group A: Core Tables ───────────────────────────────────────────
export { LiteLLM_BudgetTable } from "./budgets";
export { LiteLLM_ProxyModelTable } from "./proxyModels";
export { LiteLLM_ModelTable } from "./modelTable";
export { LiteLLM_Config } from "./config";
export { LiteLLM_ConfigOverrides } from "./configOverrides";
export { LiteLLM_CacheConfig } from "./cacheConfig";
export { LiteLLM_UISettings } from "./uiSettings";
export { LiteLLM_CredentialsTable } from "./credentials";
export { LiteLLM_CronJob } from "./cronJobs";
export { LiteLLM_HealthCheckTable } from "./healthCheck";
export { LiteLLM_TagTable } from "./tags";
export { LiteLLM_SearchToolsTable } from "./searchTools";
export { LiteLLM_UserNotifications } from "./userNotifications";

// ─── Group B: Auth & Access Tables ───────────────────────────────────
export { LiteLLM_UserTable } from "./users";
export { LiteLLM_VerificationToken } from "./verification-tokens";
export { LiteLLM_TeamTable } from "./teams";
export { LiteLLM_OrganizationTable } from "./organizations";
export { LiteLLM_OrganizationMembership } from "./organization-memberships";
export { LiteLLM_TeamMembership } from "./team-memberships";
export { LiteLLM_ProjectTable } from "./projects";
export { LiteLLM_ObjectPermissionTable } from "./object-permissions";
export { LiteLLM_AccessGroupTable } from "./access-groups";
export { LiteLLM_EndUserTable } from "./end-users";
export { LiteLLM_InvitationLink } from "./invitation-links";
export { LiteLLM_JWTKeyMapping } from "./jwt-key-mappings";
export { LiteLLM_SSOConfig } from "./sso-config";

// ─── Group C: Audit, ML & Monitoring Tables ──────────────────────────
export { liteLLM_AuditLog } from "./auditLog";
export { liteLLM_ErrorLogs } from "./errorLogs";
export { liteLLM_SpendLogs } from "./spendLogs";
export { liteLLM_SpendLogGuardrailIndex } from "./spendLogGuardrailIndex";
export { liteLLM_SpendLogToolIndex } from "./spendLogToolIndex";
export { liteLLM_DailyUserSpend } from "./dailyUserSpend";
export { liteLLM_DailyTeamSpend } from "./dailyTeamSpend";
export { liteLLM_DailyAgentSpend } from "./dailyAgentSpend";
export { liteLLM_DailyEndUserSpend } from "./dailyEndUserSpend";
export { liteLLM_DailyOrganizationSpend } from "./dailyOrganizationSpend";
export { liteLLM_DailyTagSpend } from "./dailyTagSpend";
export { liteLLM_DailyGuardrailMetrics } from "./dailyGuardrailMetrics";
export { liteLLM_DailyPolicyMetrics } from "./dailyPolicyMetrics";

// ─── Group D: Extended Features + Deleted/Audit Tables ───────────────
export { liteLLM_AgentsTable } from "./agents";
export { liteLLM_MCPServerTable } from "./mcp-servers";
export { liteLLM_MCPUserCredentials } from "./mcp-user-credentials";
export { liteLLM_GuardrailsTable } from "./guardrails";
export { liteLLM_PromptTable } from "./prompts";
export { liteLLM_PolicyTable } from "./policies";
export { liteLLM_PolicyAttachmentTable } from "./policy-attachments";
export { liteLLM_ToolTable } from "./tools";
export { liteLLM_SkillsTable } from "./skills";
export { liteLLM_ManagedFileTable } from "./managed-files";
export { liteLLM_ManagedObjectTable } from "./managed-objects";
export { liteLLM_DeletedTeamTable } from "./deleted-teams";
export { liteLLM_DeletedVerificationToken } from "./deleted-verification-tokens";
export { liteLLM_DeprecatedVerificationToken } from "./deprecated-tokens";
export { liteLLM_ManagedVectorStoreTable } from "./managed-vector-stores";
export { liteLLM_ManagedVectorStoresTable } from "./managed-vector-stores-direct";
export { liteLLM_ManagedVectorStoreIndexTable } from "./managed-vector-store-index";
export { liteLLM_ClaudeCodePluginTable } from "./claude-code-plugins";
