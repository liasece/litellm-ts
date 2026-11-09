-- 删除运行时代码已无读写的遗留 Python LiteLLM 表。
DROP TABLE IF EXISTS "LiteLLM_AccessGroupTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_AuditLog" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_CacheConfig" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ClaudeCodePluginTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ConfigOverrides" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_CronJob" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_DailyGuardrailMetrics" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_DailyPolicyMetrics" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_DeletedTeamTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ErrorLogs" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_GuardrailsTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_HealthCheckTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_InvitationLink" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_JWTKeyMapping" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_MCPServerTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_MCPUserCredentials" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ManagedFileTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ManagedObjectTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ManagedVectorStoreIndexTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ManagedVectorStoreTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ManagedVectorStoresTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ModelTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_PolicyAttachmentTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_PolicyTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_PromptTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_SSOConfig" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_SkillsTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_SpendLogGuardrailIndex" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_SpendLogToolIndex" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_TagTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_ToolTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_UISettings" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_UserNotifications" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "JobStatus";
