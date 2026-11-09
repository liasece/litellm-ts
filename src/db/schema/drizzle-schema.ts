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
export { LiteLLM_Config } from "./config";
export { LiteLLM_CredentialsTable } from "./credentials";
export { LiteLLM_SearchToolsTable } from "./searchTools";

// ─── Group B: Auth & Access Tables ───────────────────────────────────
export { LiteLLM_UserTable } from "./users";
export { LiteLLM_VerificationToken } from "./verification-tokens";
export { LiteLLM_TeamTable } from "./teams";
export { LiteLLM_OrganizationTable } from "./organizations";
export { LiteLLM_OrganizationMembership } from "./organization-memberships";
export { LiteLLM_TeamMembership } from "./team-memberships";
export { LiteLLM_ProjectTable } from "./projects";
export { LiteLLM_ObjectPermissionTable } from "./object-permissions";
export { LiteLLM_EndUserTable } from "./end-users";

// ─── Group C: Audit, ML & Monitoring Tables ──────────────────────────
export { liteLLM_SpendLogs } from "./spendLogs";
export { liteLLM_ActiveRequests } from "./activeRequests";
export { liteLLM_DailyUserSpend } from "./dailyUserSpend";
export { liteLLM_DailyTeamSpend } from "./dailyTeamSpend";
export { liteLLM_DailyAgentSpend } from "./dailyAgentSpend";
export { liteLLM_DailyEndUserSpend } from "./dailyEndUserSpend";
export { liteLLM_DailyOrganizationSpend } from "./dailyOrganizationSpend";
export { liteLLM_DailyTagSpend } from "./dailyTagSpend";

// ─── Group D: Extended Features + Deleted/Audit Tables ───────────────
export { liteLLM_AgentsTable } from "./agents";
export { liteLLM_DeletedVerificationToken } from "./deleted-verification-tokens";
export { liteLLM_DeprecatedVerificationToken } from "./deprecated-tokens";
export { liteLLM_BuiltinCapabilityImages } from "./builtinCapabilityImages";
export { liteLLM_PrivacyRedactionEvents, liteLLM_PrivacyRedactionValues } from "./privacyRedaction";
