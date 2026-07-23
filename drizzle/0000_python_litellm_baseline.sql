-- Python LiteLLM adoption/bootstrap baseline.
-- Source: /schema.prisma plus committed migrations through 20260318140652_add_index_to_team_table.
-- Existing compatible databases mark this migration adopted; empty databases execute it.

-- Source migration: 20250326162113_baseline
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_BudgetTable" (
    "budget_id" TEXT NOT NULL,
    "max_budget" DOUBLE PRECISION,
    "soft_budget" DOUBLE PRECISION,
    "max_parallel_requests" INTEGER,
    "tpm_limit" BIGINT,
    "rpm_limit" BIGINT,
    "model_max_budget" JSONB,
    "budget_duration" TEXT,
    "budget_reset_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_BudgetTable_pkey" PRIMARY KEY ("budget_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_CredentialsTable" (
    "credential_id" TEXT NOT NULL,
    "credential_name" TEXT NOT NULL,
    "credential_values" JSONB NOT NULL,
    "credential_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_CredentialsTable_pkey" PRIMARY KEY ("credential_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ProxyModelTable" (
    "model_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "litellm_params" JSONB NOT NULL,
    "model_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_ProxyModelTable_pkey" PRIMARY KEY ("model_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_OrganizationTable" (
    "organization_id" TEXT NOT NULL,
    "organization_alias" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "models" TEXT[],
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_OrganizationTable_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ModelTable" (
    "id" SERIAL NOT NULL,
    "aliases" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_ModelTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_TeamTable" (
    "team_id" TEXT NOT NULL,
    "team_alias" TEXT,
    "organization_id" TEXT,
    "admins" TEXT[],
    "members" TEXT[],
    "members_with_roles" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "max_budget" DOUBLE PRECISION,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "models" TEXT[],
    "max_parallel_requests" INTEGER,
    "tpm_limit" BIGINT,
    "rpm_limit" BIGINT,
    "budget_duration" TEXT,
    "budget_reset_at" TIMESTAMP(3),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "model_max_budget" JSONB NOT NULL DEFAULT '{}',
    "model_id" INTEGER,

    CONSTRAINT "LiteLLM_TeamTable_pkey" PRIMARY KEY ("team_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_UserTable" (
    "user_id" TEXT NOT NULL,
    "user_alias" TEXT,
    "team_id" TEXT,
    "sso_user_id" TEXT,
    "organization_id" TEXT,
    "password" TEXT,
    "teams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_role" TEXT,
    "max_budget" DOUBLE PRECISION,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "user_email" TEXT,
    "models" TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "max_parallel_requests" INTEGER,
    "tpm_limit" BIGINT,
    "rpm_limit" BIGINT,
    "budget_duration" TEXT,
    "budget_reset_at" TIMESTAMP(3),
    "allowed_cache_controls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "model_max_budget" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiteLLM_UserTable_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_VerificationToken" (
    "token" TEXT NOT NULL,
    "key_name" TEXT,
    "key_alias" TEXT,
    "soft_budget_cooldown" BOOLEAN NOT NULL DEFAULT false,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "expires" TIMESTAMP(3),
    "models" TEXT[],
    "aliases" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "user_id" TEXT,
    "team_id" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "max_parallel_requests" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "blocked" BOOLEAN,
    "tpm_limit" BIGINT,
    "rpm_limit" BIGINT,
    "max_budget" DOUBLE PRECISION,
    "budget_duration" TEXT,
    "budget_reset_at" TIMESTAMP(3),
    "allowed_cache_controls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "model_max_budget" JSONB NOT NULL DEFAULT '{}',
    "budget_id" TEXT,
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_VerificationToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_EndUserTable" (
    "user_id" TEXT NOT NULL,
    "alias" TEXT,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "allowed_model_region" TEXT,
    "default_model" TEXT,
    "budget_id" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LiteLLM_EndUserTable_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_Config" (
    "param_name" TEXT NOT NULL,
    "param_value" JSONB,

    CONSTRAINT "LiteLLM_Config_pkey" PRIMARY KEY ("param_name")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_SpendLogs" (
    "request_id" TEXT NOT NULL,
    "call_type" TEXT NOT NULL,
    "api_key" TEXT NOT NULL DEFAULT '',
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "completionStartTime" TIMESTAMP(3),
    "model" TEXT NOT NULL DEFAULT '',
    "model_id" TEXT DEFAULT '',
    "model_group" TEXT DEFAULT '',
    "custom_llm_provider" TEXT DEFAULT '',
    "api_base" TEXT DEFAULT '',
    "user" TEXT DEFAULT '',
    "metadata" JSONB DEFAULT '{}',
    "cache_hit" TEXT DEFAULT '',
    "cache_key" TEXT DEFAULT '',
    "request_tags" JSONB DEFAULT '[]',
    "team_id" TEXT,
    "end_user" TEXT,
    "requester_ip_address" TEXT,
    "messages" JSONB DEFAULT '{}',
    "response" JSONB DEFAULT '{}',

    CONSTRAINT "LiteLLM_SpendLogs_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ErrorLogs" (
    "request_id" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "api_base" TEXT NOT NULL DEFAULT '',
    "model_group" TEXT NOT NULL DEFAULT '',
    "litellm_model_name" TEXT NOT NULL DEFAULT '',
    "model_id" TEXT NOT NULL DEFAULT '',
    "request_kwargs" JSONB NOT NULL DEFAULT '{}',
    "exception_type" TEXT NOT NULL DEFAULT '',
    "exception_string" TEXT NOT NULL DEFAULT '',
    "status_code" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LiteLLM_ErrorLogs_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_UserNotifications" (
    "request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "models" TEXT[],
    "justification" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_UserNotifications_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_TeamMembership" (
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "budget_id" TEXT,

    CONSTRAINT "LiteLLM_TeamMembership_pkey" PRIMARY KEY ("user_id","team_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_OrganizationMembership" (
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_role" TEXT,
    "spend" DOUBLE PRECISION DEFAULT 0.0,
    "budget_id" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiteLLM_OrganizationMembership_pkey" PRIMARY KEY ("user_id","organization_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_InvitationLink" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "is_accepted" BOOLEAN NOT NULL DEFAULT false,
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_InvitationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_AuditLog" (
    "id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" TEXT NOT NULL DEFAULT '',
    "changed_by_api_key" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "before_value" JSONB,
    "updated_values" JSONB,

    CONSTRAINT "LiteLLM_AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_CredentialsTable_credential_name_key" ON "LiteLLM_CredentialsTable"("credential_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_TeamTable_model_id_key" ON "LiteLLM_TeamTable"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_UserTable_sso_user_id_key" ON "LiteLLM_UserTable"("sso_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogs_startTime_idx" ON "LiteLLM_SpendLogs"("startTime");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogs_end_user_idx" ON "LiteLLM_SpendLogs"("end_user");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_OrganizationMembership_user_id_organization_id_key" ON "LiteLLM_OrganizationMembership"("user_id", "organization_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_OrganizationTable_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_OrganizationTable" ADD CONSTRAINT "LiteLLM_OrganizationTable_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamTable_organization_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamTable" ADD CONSTRAINT "LiteLLM_TeamTable_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "LiteLLM_OrganizationTable"("organization_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamTable_model_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamTable" ADD CONSTRAINT "LiteLLM_TeamTable_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "LiteLLM_ModelTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_UserTable_organization_id_fkey') THEN
        ALTER TABLE "LiteLLM_UserTable" ADD CONSTRAINT "LiteLLM_UserTable_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "LiteLLM_OrganizationTable"("organization_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_VerificationToken_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_VerificationToken" ADD CONSTRAINT "LiteLLM_VerificationToken_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_VerificationToken_organization_id_fkey') THEN
        ALTER TABLE "LiteLLM_VerificationToken" ADD CONSTRAINT "LiteLLM_VerificationToken_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "LiteLLM_OrganizationTable"("organization_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_EndUserTable_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_EndUserTable" ADD CONSTRAINT "LiteLLM_EndUserTable_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamMembership_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamMembership" ADD CONSTRAINT "LiteLLM_TeamMembership_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_OrganizationMembership_user_id_fkey') THEN
        ALTER TABLE "LiteLLM_OrganizationMembership" ADD CONSTRAINT "LiteLLM_OrganizationMembership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "LiteLLM_UserTable"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_OrganizationMembership_organization_id_fkey') THEN
        ALTER TABLE "LiteLLM_OrganizationMembership" ADD CONSTRAINT "LiteLLM_OrganizationMembership_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "LiteLLM_OrganizationTable"("organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_OrganizationMembership_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_OrganizationMembership" ADD CONSTRAINT "LiteLLM_OrganizationMembership_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_InvitationLink_user_id_fkey') THEN
        ALTER TABLE "LiteLLM_InvitationLink" ADD CONSTRAINT "LiteLLM_InvitationLink_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "LiteLLM_UserTable"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_InvitationLink_created_by_fkey') THEN
        ALTER TABLE "LiteLLM_InvitationLink" ADD CONSTRAINT "LiteLLM_InvitationLink_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "LiteLLM_UserTable"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_InvitationLink_updated_by_fkey') THEN
        ALTER TABLE "LiteLLM_InvitationLink" ADD CONSTRAINT "LiteLLM_InvitationLink_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "LiteLLM_UserTable"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20250326171002_add_daily_user_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyUserSpend" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "model_group" TEXT,
    "custom_llm_provider" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyUserSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_date_idx" ON "LiteLLM_DailyUserSpend"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_user_id_idx" ON "LiteLLM_DailyUserSpend"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_api_key_idx" ON "LiteLLM_DailyUserSpend"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_model_idx" ON "LiteLLM_DailyUserSpend"("model");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_user_id_date_api_key_model_custom_ll_key" ON "LiteLLM_DailyUserSpend"("user_id", "date", "api_key", "model", "custom_llm_provider");

--> statement-breakpoint
-- Source migration: 20250327180120_add_api_requests_to_daily_user_table
-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ADD COLUMN IF NOT EXISTS "api_requests" INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint
-- Source migration: 20250329084805_new_cron_job_table
-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_CronJob" (
    "cronjob_id" TEXT NOT NULL,
    "pod_id" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'INACTIVE',
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ttl" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_CronJob_pkey" PRIMARY KEY ("cronjob_id")
);

--> statement-breakpoint
-- Source migration: 20250331215456_track_success_and_failed_requests_daily_agg_table
-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ADD COLUMN IF NOT EXISTS "failed_requests" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "successful_requests" INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint
-- Source migration: 20250411215431_add_managed_file_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ManagedFileTable" (
    "id" TEXT NOT NULL,
    "unified_file_id" TEXT NOT NULL,
    "file_object" JSONB NOT NULL,
    "model_mappings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_ManagedFileTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ManagedFileTable_unified_file_id_key" ON "LiteLLM_ManagedFileTable"("unified_file_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ManagedFileTable_unified_file_id_idx" ON "LiteLLM_ManagedFileTable"("unified_file_id");

--> statement-breakpoint
-- Source migration: 20250412081753_team_member_permissions
-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "team_member_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20250415151647_add_cache_read_write_tokens_daily_spend_transactions
-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint
-- Source migration: 20250415191926_add_daily_team_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyTeamSpend" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "model_group" TEXT,
    "custom_llm_provider" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "api_requests" INTEGER NOT NULL DEFAULT 0,
    "successful_requests" INTEGER NOT NULL DEFAULT 0,
    "failed_requests" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyTeamSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_date_idx" ON "LiteLLM_DailyTeamSpend"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_team_id_idx" ON "LiteLLM_DailyTeamSpend"("team_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_api_key_idx" ON "LiteLLM_DailyTeamSpend"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_model_idx" ON "LiteLLM_DailyTeamSpend"("model");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_team_id_date_api_key_model_custom_ll_key" ON "LiteLLM_DailyTeamSpend"("team_id", "date", "api_key", "model", "custom_llm_provider");

--> statement-breakpoint
-- Source migration: 20250416115320_add_tag_table_to_db
-- AlterTable
ALTER TABLE "LiteLLM_DailyTeamSpend" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyTagSpend" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "model_group" TEXT,
    "custom_llm_provider" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_creation_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "api_requests" INTEGER NOT NULL DEFAULT 0,
    "successful_requests" INTEGER NOT NULL DEFAULT 0,
    "failed_requests" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyTagSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_tag_key" ON "LiteLLM_DailyTagSpend"("tag");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_date_idx" ON "LiteLLM_DailyTagSpend"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_tag_idx" ON "LiteLLM_DailyTagSpend"("tag");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_api_key_idx" ON "LiteLLM_DailyTagSpend"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_model_idx" ON "LiteLLM_DailyTagSpend"("model");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_tag_date_api_key_model_custom_llm_pro_key" ON "LiteLLM_DailyTagSpend"("tag", "date", "api_key", "model", "custom_llm_provider");

--> statement-breakpoint
-- Source migration: 20250416151339_drop_tag_uniqueness_requirement
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTagSpend_tag_key";

--> statement-breakpoint
-- Source migration: 20250416185146_add_allowed_routes_litellm_verification_token
-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "allowed_routes" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20250425182129_add_session_id
-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "proxy_server_request" JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "session_id" TEXT;

--> statement-breakpoint
-- Source migration: 20250430193429_add_managed_vector_stores
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ManagedVectorStoresTable" (
    "vector_store_id" TEXT NOT NULL,
    "custom_llm_provider" TEXT NOT NULL,
    "vector_store_name" TEXT,
    "vector_store_description" TEXT,
    "vector_store_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "litellm_credential_name" TEXT,

    CONSTRAINT "LiteLLM_ManagedVectorStoresTable_pkey" PRIMARY KEY ("vector_store_id")
);

--> statement-breakpoint
-- Source migration: 20250507161526_add_mcp_table_to_db
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_MCPServerTable" (
    "server_id" TEXT NOT NULL,
    "alias" TEXT,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'sse',
    "spec_version" TEXT NOT NULL DEFAULT '2025-03-26',
    "auth_type" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_MCPServerTable_pkey" PRIMARY KEY ("server_id")
);

--> statement-breakpoint
-- Source migration: 20250507161527_add_health_check_fields_to_mcp_servers
-- Add health check fields to MCP server table
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'unknown';
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "last_health_check" TIMESTAMP(3);
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "health_check_error" TEXT;
--> statement-breakpoint
-- Source migration: 20250507184818_add_mcp_key_team_permission_mgmt
-- AlterTable
ALTER TABLE "LiteLLM_OrganizationTable" ADD COLUMN IF NOT EXISTS "object_permission_id" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "object_permission_id" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_UserTable" ADD COLUMN IF NOT EXISTS "object_permission_id" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "object_permission_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ObjectPermissionTable" (
    "object_permission_id" TEXT NOT NULL,
    "mcp_servers" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "LiteLLM_ObjectPermissionTable_pkey" PRIMARY KEY ("object_permission_id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_OrganizationTable_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_OrganizationTable" ADD CONSTRAINT "LiteLLM_OrganizationTable_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamTable_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamTable" ADD CONSTRAINT "LiteLLM_TeamTable_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_UserTable_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_UserTable" ADD CONSTRAINT "LiteLLM_UserTable_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_VerificationToken_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_VerificationToken" ADD CONSTRAINT "LiteLLM_VerificationToken_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20250508072103_add_status_to_spendlogs
-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "status" TEXT;

--> statement-breakpoint
-- Source migration: 20250509141545_use_big_int_for_daily_spend_tables
-- AlterTable
ALTER TABLE "LiteLLM_DailyTagSpend" ALTER COLUMN "prompt_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "completion_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "cache_read_input_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "cache_creation_input_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "api_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "successful_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "failed_requests" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyTeamSpend" ALTER COLUMN "prompt_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "completion_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "api_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "successful_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "failed_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "cache_creation_input_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "cache_read_input_tokens" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ALTER COLUMN "prompt_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "completion_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "api_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "failed_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "successful_requests" SET DATA TYPE BIGINT,
ALTER COLUMN "cache_creation_input_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "cache_read_input_tokens" SET DATA TYPE BIGINT;

--> statement-breakpoint
-- Source migration: 20250510142544_add_session_id_index_spend_logs
-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogs_session_id_idx" ON "LiteLLM_SpendLogs"("session_id");

--> statement-breakpoint
-- Source migration: 20250514142245_add_guardrails_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_GuardrailsTable" (
    "guardrail_id" TEXT NOT NULL,
    "guardrail_name" TEXT NOT NULL,
    "litellm_params" JSONB NOT NULL,
    "guardrail_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_GuardrailsTable_pkey" PRIMARY KEY ("guardrail_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_GuardrailsTable_guardrail_name_key" ON "LiteLLM_GuardrailsTable"("guardrail_name");

--> statement-breakpoint
-- Source migration: 20250522223020_managed_object_table
-- AlterTable
ALTER TABLE "LiteLLM_ManagedFileTable" ADD COLUMN IF NOT EXISTS "created_by" TEXT,
ADD COLUMN IF NOT EXISTS "flat_model_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "updated_by" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ManagedObjectTable" (
    "id" TEXT NOT NULL,
    "unified_object_id" TEXT NOT NULL,
    "model_object_id" TEXT NOT NULL,
    "file_object" JSONB NOT NULL,
    "file_purpose" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_ManagedObjectTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ManagedObjectTable_unified_object_id_key" ON "LiteLLM_ManagedObjectTable"("unified_object_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ManagedObjectTable_model_object_id_key" ON "LiteLLM_ManagedObjectTable"("model_object_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ManagedObjectTable_unified_object_id_idx" ON "LiteLLM_ManagedObjectTable"("unified_object_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ManagedObjectTable_model_object_id_idx" ON "LiteLLM_ManagedObjectTable"("model_object_id");

--> statement-breakpoint
-- Source migration: 20250526154401_allow_null_entity_id
-- AlterTable
ALTER TABLE "LiteLLM_DailyTagSpend" ALTER COLUMN "tag" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiteLLM_DailyTeamSpend" ALTER COLUMN "team_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ALTER COLUMN "user_id" DROP NOT NULL;

--> statement-breakpoint
-- Source migration: 20250528185438_add_vector_stores_to_object_permissions
-- AlterTable
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "vector_stores" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20250603210143_cascade_budget_changes
-- DropForeignKey
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamMembership_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamMembership" DROP CONSTRAINT "LiteLLM_TeamMembership_budget_id_fkey";
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamMembership_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamMembership" ADD CONSTRAINT "LiteLLM_TeamMembership_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20250618225828_add_health_check_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_HealthCheckTable" (
    "health_check_id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_id" TEXT,
    "status" TEXT NOT NULL,
    "healthy_count" INTEGER NOT NULL DEFAULT 0,
    "unhealthy_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "response_time_ms" DOUBLE PRECISION,
    "details" JSONB,
    "checked_by" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_HealthCheckTable_pkey" PRIMARY KEY ("health_check_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_HealthCheckTable_model_name_idx" ON "LiteLLM_HealthCheckTable"("model_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_HealthCheckTable_checked_at_idx" ON "LiteLLM_HealthCheckTable"("checked_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_HealthCheckTable_status_idx" ON "LiteLLM_HealthCheckTable"("status");

--> statement-breakpoint
-- Source migration: 20250625145206_cascade_budget_and_loosen_managed_file_json
-- DropForeignKey
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamMembership_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamMembership" DROP CONSTRAINT "LiteLLM_TeamMembership_budget_id_fkey";
    END IF;
END $$;

-- AlterTable
ALTER TABLE "LiteLLM_ManagedFileTable" ALTER COLUMN "file_object" DROP NOT NULL;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TeamMembership_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_TeamMembership" ADD CONSTRAINT "LiteLLM_TeamMembership_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20250625213625_add_status_to_managed_object_table
-- AlterTable
ALTER TABLE "LiteLLM_ManagedObjectTable" ADD COLUMN IF NOT EXISTS "status" TEXT;

--> statement-breakpoint
-- Source migration: 20250707212517_add_mcp_info_column_mcp_servers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "mcp_info" JSONB DEFAULT '{}';

--> statement-breakpoint
-- Source migration: 20250707230009_add_mcp_namespaced_tool_name
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTagSpend_tag_date_api_key_model_custom_llm_pro_key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTeamSpend_team_id_date_api_key_model_custom_ll_key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyUserSpend_user_id_date_api_key_model_custom_ll_key";

-- AlterTable
ALTER TABLE "LiteLLM_DailyTagSpend" ADD COLUMN IF NOT EXISTS "mcp_namespaced_tool_name" TEXT,
ALTER COLUMN "model" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiteLLM_DailyTeamSpend" ADD COLUMN IF NOT EXISTS "mcp_namespaced_tool_name" TEXT,
ALTER COLUMN "model" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ADD COLUMN IF NOT EXISTS "mcp_namespaced_tool_name" TEXT,
ALTER COLUMN "model" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "mcp_namespaced_tool_name" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_mcp_namespaced_tool_name_idx" ON "LiteLLM_DailyTagSpend"("mcp_namespaced_tool_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_tag_date_api_key_model_custom_llm_pro_key" ON "LiteLLM_DailyTagSpend"("tag", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_mcp_namespaced_tool_name_idx" ON "LiteLLM_DailyTeamSpend"("mcp_namespaced_tool_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_team_id_date_api_key_model_custom_ll_key" ON "LiteLLM_DailyTeamSpend"("team_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_mcp_namespaced_tool_name_idx" ON "LiteLLM_DailyUserSpend"("mcp_namespaced_tool_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_user_id_date_api_key_model_custom_ll_key" ON "LiteLLM_DailyUserSpend"("user_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name");

--> statement-breakpoint
-- Source migration: 20250711220620_add_stdio_mcp
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "args" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "command" TEXT,
ADD COLUMN IF NOT EXISTS "env" JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "mcp_access_groups" TEXT[],
ALTER COLUMN "url" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "mcp_access_groups" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20250718125714_add_litellm_params_to_vector_stores
-- AlterTable
ALTER TABLE "LiteLLM_ManagedVectorStoresTable" ADD COLUMN IF NOT EXISTS "litellm_params" JSONB;

--> statement-breakpoint
-- Source migration: 20250802162330_prompt_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_PromptTable" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "litellm_params" JSONB NOT NULL,
    "prompt_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_PromptTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_PromptTable_prompt_id_key" ON "LiteLLM_PromptTable"("prompt_id");

--> statement-breakpoint
-- Source migration: 20250806095134_rename_alias_to_server_name_mcp_table
-- Migration for existing tables: rename alias to server_name if upgrading
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'LiteLLM_MCPServerTable' AND column_name = 'alias') THEN
        ALTER TABLE "LiteLLM_MCPServerTable" RENAME COLUMN "alias" TO "server_name";
    END IF;
END $$;

-- Migration for existing tables: add alias column if upgrading
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "alias" TEXT;
--> statement-breakpoint
-- Source migration: 20250918083359_drop_spec_version_column_from_mcp_table
/*
  Warnings:

  - You are about to drop the column `spec_version` on the `LiteLLM_MCPServerTable` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" DROP COLUMN IF EXISTS "spec_version";
--> statement-breakpoint
-- Source migration: 20250926194702_unnamed_migration
-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "auto_rotate" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "key_rotation_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "last_rotation_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "rotation_count" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "rotation_interval" TEXT;

--> statement-breakpoint
-- Source migration: 20251003165142_add_allowed_tools_to_mcp
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20251003190954_extra_headers_to_mcp_table
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "extra_headers" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20251006143948_add_mcp_tool_permissions
-- AlterTable
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "mcp_tool_permissions" JSONB;

--> statement-breakpoint
-- Source migration: 20251011084309_add_tag_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_TagTable" (
    "tag_name" TEXT NOT NULL,
    "description" TEXT,
    "models" TEXT[],
    "model_info" JSONB,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "budget_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiteLLM_TagTable_pkey" PRIMARY KEY ("tag_name")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_TagTable_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_TagTable" ADD CONSTRAINT "LiteLLM_TagTable_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20251023141814_add_search_tool_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_SearchToolsTable" (
    "search_tool_id" TEXT NOT NULL,
    "search_tool_name" TEXT NOT NULL,
    "litellm_params" JSONB NOT NULL,
    "search_tool_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_SearchToolsTable_pkey" PRIMARY KEY ("search_tool_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_SearchToolsTable_search_tool_name_key" ON "LiteLLM_SearchToolsTable"("search_tool_name");

--> statement-breakpoint
-- Source migration: 20251031181430_add_cache_config_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_SSOConfig" (
    "id" TEXT NOT NULL DEFAULT 'sso_config',
    "sso_settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_SSOConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_CacheConfig" (
    "id" TEXT NOT NULL DEFAULT 'cache_config',
    "cache_settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_CacheConfig_pkey" PRIMARY KEY ("id")
);

--> statement-breakpoint
-- Source migration: 20251101131415_add_managed_vector_store_index_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ManagedVectorStoreIndexTable" (
    "id" TEXT NOT NULL,
    "index_name" TEXT NOT NULL,
    "litellm_params" JSONB NOT NULL,
    "index_info" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_ManagedVectorStoreIndexTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ManagedVectorStoreIndexTable_index_name_key" ON "LiteLLM_ManagedVectorStoreIndexTable"("index_name");

--> statement-breakpoint
-- Source migration: 20251103072422_add_static_headers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "static_headers" JSONB DEFAULT '{}';
--> statement-breakpoint
-- Source migration: 20251104220043_add_credentials_to_mcp_servers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "credentials" JSONB DEFAULT '{}';
--> statement-breakpoint
-- Source migration: 20251113000000_add_project_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ProjectTable" (
    "project_id" TEXT NOT NULL,
    "project_alias" TEXT,
    "team_id" TEXT,
    "budget_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "models" TEXT[],
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "object_permission_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_ProjectTable_pkey" PRIMARY KEY ("project_id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_ProjectTable_team_id_fkey') THEN
        ALTER TABLE "LiteLLM_ProjectTable" ADD CONSTRAINT "LiteLLM_ProjectTable_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "LiteLLM_TeamTable"("team_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_ProjectTable_budget_id_fkey') THEN
        ALTER TABLE "LiteLLM_ProjectTable" ADD CONSTRAINT "LiteLLM_ProjectTable_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "LiteLLM_BudgetTable"("budget_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_ProjectTable_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_ProjectTable" ADD CONSTRAINT "LiteLLM_ProjectTable_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable: Add project_id to LiteLLM_VerificationToken
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "project_id" TEXT;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_VerificationToken_project_id_fkey') THEN
        ALTER TABLE "LiteLLM_VerificationToken" ADD CONSTRAINT "LiteLLM_VerificationToken_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "LiteLLM_ProjectTable"("project_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20251113000001_add_project_fields
-- AlterTable: Add new fields to LiteLLM_ProjectTable
ALTER TABLE "LiteLLM_ProjectTable" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "LiteLLM_ProjectTable" ADD COLUMN IF NOT EXISTS "model_rpm_limit" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "LiteLLM_ProjectTable" ADD COLUMN IF NOT EXISTS "model_tpm_limit" JSONB NOT NULL DEFAULT '{}';

--> statement-breakpoint
-- Source migration: 20251114173537_add_request_id_to_daily_tag_spend
-- AlterTable
ALTER TABLE "LiteLLM_DailyTagSpend" ADD COLUMN IF NOT EXISTS "request_id" TEXT;

--> statement-breakpoint
-- Source migration: 20251114180624_Add_org_usage_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyOrganizationSpend" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "model" TEXT,
    "model_group" TEXT,
    "custom_llm_provider" TEXT,
    "mcp_namespaced_tool_name" TEXT,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_read_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_creation_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "api_requests" BIGINT NOT NULL DEFAULT 0,
    "successful_requests" BIGINT NOT NULL DEFAULT 0,
    "failed_requests" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyOrganizationSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_date_idx" ON "LiteLLM_DailyOrganizationSpend"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_idx" ON "LiteLLM_DailyOrganizationSpend"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_api_key_idx" ON "LiteLLM_DailyOrganizationSpend"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_model_idx" ON "LiteLLM_DailyOrganizationSpend"("model");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_mcp_namespaced_tool_name_idx" ON "LiteLLM_DailyOrganizationSpend"("mcp_namespaced_tool_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_date_api_key_key" ON "LiteLLM_DailyOrganizationSpend"("organization_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name");

--> statement-breakpoint
-- Source migration: 20251114182247_agents_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_AgentsTable" (
    "agent_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "litellm_params" JSONB,
    "agent_card_params" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT NOT NULL,

    CONSTRAINT "LiteLLM_AgentsTable_pkey" PRIMARY KEY ("agent_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_AgentsTable_agent_name_key" ON "LiteLLM_AgentsTable"("agent_name");

--> statement-breakpoint
-- Source migration: 20251119131227_add_prompt_versioning
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_PromptTable_prompt_id_key";

-- AlterTable
ALTER TABLE "LiteLLM_PromptTable"
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_PromptTable_prompt_id_idx" ON "LiteLLM_PromptTable" ("prompt_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_PromptTable_prompt_id_version_key" ON "LiteLLM_PromptTable" ("prompt_id", "version");
--> statement-breakpoint
-- Source migration: 20251122125322_Add organization_id to spend logs
-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;

--> statement-breakpoint
-- Source migration: 20251204124859_add_end_user_spend_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyEndUserSpend" (
    "id" TEXT NOT NULL,
    "end_user_id" TEXT,
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "model" TEXT,
    "model_group" TEXT,
    "custom_llm_provider" TEXT,
    "mcp_namespaced_tool_name" TEXT,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_read_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_creation_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "api_requests" BIGINT NOT NULL DEFAULT 0,
    "successful_requests" BIGINT NOT NULL DEFAULT 0,
    "failed_requests" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyEndUserSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_date_idx" ON "LiteLLM_DailyEndUserSpend"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_idx" ON "LiteLLM_DailyEndUserSpend"("end_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_api_key_idx" ON "LiteLLM_DailyEndUserSpend"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_model_idx" ON "LiteLLM_DailyEndUserSpend"("model");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_mcp_namespaced_tool_name_idx" ON "LiteLLM_DailyEndUserSpend"("mcp_namespaced_tool_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_date_api_key_model_cu_key" ON "LiteLLM_DailyEndUserSpend"("end_user_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name");

--> statement-breakpoint
-- Source migration: 20251204142718_add_agent_permissions
-- Add agent permission fields to LiteLLM_ObjectPermissionTable
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "agents" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "agent_access_groups" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add agent_access_groups field to LiteLLM_AgentsTable
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "agent_access_groups" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20251209112246_add_ui_settings_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_UISettings" (
    "id" TEXT NOT NULL DEFAULT 'ui_settings',
    "ui_settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_UISettings_pkey" PRIMARY KEY ("id")
);

--> statement-breakpoint
-- Source migration: 20251210125210_add_storage_backend_to_managed_files
-- AlterTable
ALTER TABLE "LiteLLM_ManagedFileTable" ADD COLUMN IF NOT EXISTS "storage_backend" TEXT;
ALTER TABLE "LiteLLM_ManagedFileTable" ADD COLUMN IF NOT EXISTS "storage_url" TEXT;

--> statement-breakpoint
-- Source migration: 20251210205007_add_daily_agent_spend_table
-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyAgentSpend" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "date" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "model" TEXT,
    "model_group" TEXT,
    "custom_llm_provider" TEXT,
    "mcp_namespaced_tool_name" TEXT,
    "prompt_tokens" BIGINT NOT NULL DEFAULT 0,
    "completion_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_read_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "cache_creation_input_tokens" BIGINT NOT NULL DEFAULT 0,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "api_requests" BIGINT NOT NULL DEFAULT 0,
    "successful_requests" BIGINT NOT NULL DEFAULT 0,
    "failed_requests" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyAgentSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_date_idx" ON "LiteLLM_DailyAgentSpend"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_agent_id_idx" ON "LiteLLM_DailyAgentSpend"("agent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_api_key_idx" ON "LiteLLM_DailyAgentSpend"("api_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_model_idx" ON "LiteLLM_DailyAgentSpend"("model");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_mcp_namespaced_tool_name_idx" ON "LiteLLM_DailyAgentSpend"("mcp_namespaced_tool_name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_agent_id_date_api_key_model_custom__key" ON "LiteLLM_DailyAgentSpend"("agent_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name");

--> statement-breakpoint
-- Source migration: 20251211100212_schema_sync
-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;

--> statement-breakpoint
-- Source migration: 20251219110931_add_deleted_keys_and_deleted_teams_tables
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DeletedTeamTable" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_alias" TEXT,
    "organization_id" TEXT,
    "object_permission_id" TEXT,
    "admins" TEXT[],
    "members" TEXT[],
    "members_with_roles" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "max_budget" DOUBLE PRECISION,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "models" TEXT[],
    "max_parallel_requests" INTEGER,
    "tpm_limit" BIGINT,
    "rpm_limit" BIGINT,
    "budget_duration" TEXT,
    "budget_reset_at" TIMESTAMP(3),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "model_max_budget" JSONB NOT NULL DEFAULT '{}',
    "team_member_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_id" INTEGER,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" TEXT,
    "deleted_by_api_key" TEXT,
    "litellm_changed_by" TEXT,

    CONSTRAINT "LiteLLM_DeletedTeamTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DeletedVerificationToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "key_name" TEXT,
    "key_alias" TEXT,
    "soft_budget_cooldown" BOOLEAN NOT NULL DEFAULT false,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "expires" TIMESTAMP(3),
    "models" TEXT[],
    "aliases" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "user_id" TEXT,
    "team_id" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "max_parallel_requests" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "blocked" BOOLEAN,
    "tpm_limit" BIGINT,
    "rpm_limit" BIGINT,
    "max_budget" DOUBLE PRECISION,
    "budget_duration" TEXT,
    "budget_reset_at" TIMESTAMP(3),
    "allowed_cache_controls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_routes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model_spend" JSONB NOT NULL DEFAULT '{}',
    "model_max_budget" JSONB NOT NULL DEFAULT '{}',
    "budget_id" TEXT,
    "organization_id" TEXT,
    "object_permission_id" TEXT,
    "created_at" TIMESTAMP(3),
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "rotation_count" INTEGER DEFAULT 0,
    "auto_rotate" BOOLEAN DEFAULT false,
    "rotation_interval" TEXT,
    "last_rotation_at" TIMESTAMP(3),
    "key_rotation_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by" TEXT,
    "deleted_by_api_key" TEXT,
    "litellm_changed_by" TEXT,

    CONSTRAINT "LiteLLM_DeletedVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedTeamTable_team_id_idx" ON "LiteLLM_DeletedTeamTable"("team_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedTeamTable_deleted_at_idx" ON "LiteLLM_DeletedTeamTable"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedTeamTable_organization_id_idx" ON "LiteLLM_DeletedTeamTable"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedTeamTable_team_alias_idx" ON "LiteLLM_DeletedTeamTable"("team_alias");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedTeamTable_created_at_idx" ON "LiteLLM_DeletedTeamTable"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_token_idx" ON "LiteLLM_DeletedVerificationToken"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_deleted_at_idx" ON "LiteLLM_DeletedVerificationToken"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_user_id_idx" ON "LiteLLM_DeletedVerificationToken"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_team_id_idx" ON "LiteLLM_DeletedVerificationToken"("team_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_organization_id_idx" ON "LiteLLM_DeletedVerificationToken"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_key_alias_idx" ON "LiteLLM_DeletedVerificationToken"("key_alias");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeletedVerificationToken_created_at_idx" ON "LiteLLM_DeletedVerificationToken"("created_at");

--> statement-breakpoint
-- Source migration: 20251220144550_schema_update
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_SkillsTable" (
    "skill_id" TEXT NOT NULL,
    "display_title" TEXT,
    "description" TEXT,
    "instructions" TEXT,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "latest_version" TEXT,
    "file_content" BYTEA,
    "file_name" TEXT,
    "file_type" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_SkillsTable_pkey" PRIMARY KEY ("skill_id")
);

--> statement-breakpoint
-- Source migration: 20260102131258_add_metadata_urls_to_mcp_servers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "authorization_url" TEXT,
ADD COLUMN IF NOT EXISTS "registration_url" TEXT,
ADD COLUMN IF NOT EXISTS "token_url" TEXT;

--> statement-breakpoint
-- Source migration: 20260105151539_add_allow_all_keys_to_mcp_servers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "allow_all_keys" BOOLEAN NOT NULL DEFAULT false;

--> statement-breakpoint
-- Source migration: 20260106155622_add_endpoint_to_daily_activity_tables
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyAgentSpend_agent_id_date_api_key_model_custom__key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_date_api_key_model_cu_key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_date_api_key_key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTagSpend_tag_date_api_key_model_custom_llm_pro_key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTeamSpend_team_id_date_api_key_model_custom_ll_key";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyUserSpend_user_id_date_api_key_model_custom_ll_key";

-- AlterTable
ALTER TABLE "LiteLLM_DailyAgentSpend" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyEndUserSpend" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyOrganizationSpend" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyTagSpend" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyTeamSpend" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_DailyUserSpend" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_endpoint_idx" ON "LiteLLM_DailyAgentSpend"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_agent_id_date_api_key_model_custom__key" ON "LiteLLM_DailyAgentSpend"("agent_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name", "endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_endpoint_idx" ON "LiteLLM_DailyEndUserSpend"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_date_api_key_model_cu_key" ON "LiteLLM_DailyEndUserSpend"("end_user_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name", "endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_endpoint_idx" ON "LiteLLM_DailyOrganizationSpend"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_date_api_key_key" ON "LiteLLM_DailyOrganizationSpend"("organization_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name", "endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_endpoint_idx" ON "LiteLLM_DailyTagSpend"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_tag_date_api_key_model_custom_llm_pro_key" ON "LiteLLM_DailyTagSpend"("tag", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name", "endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_endpoint_idx" ON "LiteLLM_DailyTeamSpend"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_team_id_date_api_key_model_custom_ll_key" ON "LiteLLM_DailyTeamSpend"("team_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name", "endpoint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_endpoint_idx" ON "LiteLLM_DailyUserSpend"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_user_id_date_api_key_model_custom_ll_key" ON "LiteLLM_DailyUserSpend"("user_id", "date", "api_key", "model", "custom_llm_provider", "mcp_namespaced_tool_name", "endpoint");

--> statement-breakpoint
-- Source migration: 20260107111013_add_router_settings_to_keys_teams
-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "router_settings" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "router_settings" JSONB DEFAULT '{}';

--> statement-breakpoint
-- Source migration: 20260108_add_user_email_lower_idx
-- CreateIndex
-- Fixes performance issue in _check_duplicate_user_email function
-- by enabling fast case-insensitive email lookups.
--
-- Without this index, queries with mode: "insensitive" cause full table scans.
-- With this index, PostgreSQL can use an Index Scan for O(log n) performance.
--
-- Related: GitHub Issue #18411
CREATE INDEX IF NOT EXISTS "LiteLLM_UserTable_user_email_lower_idx" ON "LiteLLM_UserTable"(LOWER("user_email"));
--> statement-breakpoint
-- Source migration: 20260116142756_update_deleted_keys_teams_table_routing_settings
-- AlterTable
ALTER TABLE "LiteLLM_DeletedTeamTable" ADD COLUMN IF NOT EXISTS "router_settings" JSONB DEFAULT '{}';

-- AlterTable
ALTER TABLE "LiteLLM_DeletedVerificationToken" ADD COLUMN IF NOT EXISTS "router_settings" JSONB DEFAULT '{}';

--> statement-breakpoint
-- Source migration: 20260123131407_add_policy_tables_and_policies_field
-- AlterTable
ALTER TABLE "LiteLLM_DeletedTeamTable" ADD COLUMN IF NOT EXISTS "policies" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_DeletedVerificationToken" ADD COLUMN IF NOT EXISTS "policies" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "policies" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_UserTable" ADD COLUMN IF NOT EXISTS "policies" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "policies" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_PolicyTable" (
    "policy_id" TEXT NOT NULL,
    "policy_name" TEXT NOT NULL,
    "inherit" TEXT,
    "description" TEXT,
    "guardrails_add" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "guardrails_remove" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "condition" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_PolicyTable_pkey" PRIMARY KEY ("policy_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_PolicyAttachmentTable" (
    "attachment_id" TEXT NOT NULL,
    "policy_name" TEXT NOT NULL,
    "scope" TEXT,
    "teams" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_PolicyAttachmentTable_pkey" PRIMARY KEY ("attachment_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_PolicyTable_policy_name_key" ON "LiteLLM_PolicyTable"("policy_name");

--> statement-breakpoint
-- Source migration: 20260131150814_add_team_user_to_vector_stores
-- AlterTable
ALTER TABLE "LiteLLM_ManagedVectorStoresTable"
    ADD COLUMN IF NOT EXISTS "team_id" TEXT,
    ADD COLUMN IF NOT EXISTS "user_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ManagedVectorStoresTable_team_id_idx"
    ON "LiteLLM_ManagedVectorStoresTable"("team_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ManagedVectorStoresTable_user_id_idx"
    ON "LiteLLM_ManagedVectorStoresTable"("user_id");

--> statement-breakpoint
-- Source migration: 20260203120000_add_deprecated_verification_token_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DeprecatedVerificationToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active_token_id" TEXT NOT NULL,
    "revoke_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiteLLM_DeprecatedVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_DeprecatedVerificationToken_token_key" ON "LiteLLM_DeprecatedVerificationToken"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeprecatedVerificationToken_token_revoke_at_idx" ON "LiteLLM_DeprecatedVerificationToken"("token", "revoke_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DeprecatedVerificationToken_revoke_at_idx" ON "LiteLLM_DeprecatedVerificationToken"("revoke_at");
--> statement-breakpoint
-- Source migration: 20260205091235_allow_team_guardrail_config
-- AlterTable
ALTER TABLE "LiteLLM_DeletedTeamTable" ADD COLUMN IF NOT EXISTS "allow_team_guardrail_config" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "allow_team_guardrail_config" BOOLEAN NOT NULL DEFAULT false;

--> statement-breakpoint
-- Source migration: 20260205144610_add_soft_budget_to_team_table
-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "soft_budget" DOUBLE PRECISION;

--> statement-breakpoint
-- Source migration: 20260207093506_add_available_on_public_internet_to_mcp_servers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "available_on_public_internet" BOOLEAN NOT NULL DEFAULT false;

--> statement-breakpoint
-- Source migration: 20260207110613_add_soft_budget_to_deleted_teams_table
-- AlterTable
ALTER TABLE "LiteLLM_DeletedTeamTable" ADD COLUMN IF NOT EXISTS "soft_budget" DOUBLE PRECISION;

--> statement-breakpoint
-- Source migration: 20260209085821_add_verificationtoken_indexes
-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_VerificationToken_user_id_team_id_idx" ON "LiteLLM_VerificationToken"("user_id", "team_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_VerificationToken_team_id_idx" ON "LiteLLM_VerificationToken"("team_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_VerificationToken_budget_reset_at_expires_idx" ON "LiteLLM_VerificationToken"("budget_reset_at", "expires");
--> statement-breakpoint
-- Source migration: 20260212103349_adjust_tags_policy_table
-- AlterTable
ALTER TABLE "LiteLLM_PolicyAttachmentTable" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20260212143306_add_access_group_table
-- AlterTable
ALTER TABLE "LiteLLM_DeletedTeamTable" ADD COLUMN IF NOT EXISTS "access_group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_DeletedVerificationToken" ADD COLUMN IF NOT EXISTS "access_group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_TeamTable" ADD COLUMN IF NOT EXISTS "access_group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "access_group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_AccessGroupTable" (
    "access_group_id" TEXT NOT NULL,
    "access_group_name" TEXT NOT NULL,
    "description" TEXT,
    "access_model_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "access_mcp_server_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "access_agent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigned_team_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigned_key_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_AccessGroupTable_pkey" PRIMARY KEY ("access_group_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_AccessGroupTable_access_group_name_key" ON "LiteLLM_AccessGroupTable"("access_group_name");

--> statement-breakpoint
-- Source migration: 20260213105436_add_managed_vector_store_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ManagedVectorStoreTable" (
    "id" TEXT NOT NULL,
    "unified_resource_id" TEXT NOT NULL,
    "resource_object" JSONB,
    "model_mappings" JSONB NOT NULL,
    "flat_model_resource_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "storage_backend" TEXT,
    "storage_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_ManagedVectorStoreTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ManagedVectorStoreTable_unified_resource_id_key" ON "LiteLLM_ManagedVectorStoreTable"("unified_resource_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ManagedVectorStoreTable_unified_resource_id_idx" ON "LiteLLM_ManagedVectorStoreTable"("unified_resource_id");
--> statement-breakpoint
-- Source migration: 20260213170952_access_group_change_to_model_name
-- AlterTable
ALTER TABLE "LiteLLM_AccessGroupTable" DROP COLUMN IF EXISTS "access_model_ids",
ADD COLUMN IF NOT EXISTS "access_model_names" TEXT[] DEFAULT ARRAY[]::TEXT[];
--> statement-breakpoint
-- Source migration: 20260214094754_schema_sync
-- AlterTable
ALTER TABLE "LiteLLM_GuardrailsTable" ADD COLUMN IF NOT EXISTS "team_id" TEXT;

--> statement-breakpoint
-- Source migration: 20260214163027_add_pipeline_to_policy_table
-- AlterTable
ALTER TABLE "LiteLLM_PolicyTable" ADD COLUMN IF NOT EXISTS "pipeline" JSONB;

--> statement-breakpoint
-- Source migration: 20260214185341_object_permissions_for_end_users
-- AlterTable
ALTER TABLE "LiteLLM_EndUserTable" ADD COLUMN IF NOT EXISTS "object_permission_id" TEXT;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_EndUserTable_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_EndUserTable" ADD CONSTRAINT "LiteLLM_EndUserTable_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20260218231534_add_last_active_to_key_table
-- AlterTable
ALTER TABLE "LiteLLM_DeletedVerificationToken" ADD COLUMN IF NOT EXISTS "last_active" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "last_active" TIMESTAMP(3);

--> statement-breakpoint
-- Source migration: 20260219105005_add_project_id_to_deleted_keys
-- AlterTable
ALTER TABLE "LiteLLM_DeletedVerificationToken" ADD COLUMN IF NOT EXISTS "project_id" TEXT;

--> statement-breakpoint
-- Source migration: 20260219181415_baseline_diff
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyGuardrailMetrics" (
    "guardrail_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "requests_evaluated" BIGINT NOT NULL DEFAULT 0,
    "passed_count" BIGINT NOT NULL DEFAULT 0,
    "blocked_count" BIGINT NOT NULL DEFAULT 0,
    "flagged_count" BIGINT NOT NULL DEFAULT 0,
    "avg_score" DOUBLE PRECISION,
    "avg_latency_ms" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyGuardrailMetrics_pkey" PRIMARY KEY ("guardrail_id","date")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_DailyPolicyMetrics" (
    "policy_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "requests_evaluated" BIGINT NOT NULL DEFAULT 0,
    "passed_count" BIGINT NOT NULL DEFAULT 0,
    "blocked_count" BIGINT NOT NULL DEFAULT 0,
    "flagged_count" BIGINT NOT NULL DEFAULT 0,
    "avg_score" DOUBLE PRECISION,
    "avg_latency_ms" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_DailyPolicyMetrics_pkey" PRIMARY KEY ("policy_id","date")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_SpendLogGuardrailIndex" (
    "request_id" TEXT NOT NULL,
    "guardrail_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_SpendLogGuardrailIndex_pkey" PRIMARY KEY ("request_id","guardrail_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyGuardrailMetrics_date_idx" ON "LiteLLM_DailyGuardrailMetrics"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyGuardrailMetrics_guardrail_id_idx" ON "LiteLLM_DailyGuardrailMetrics"("guardrail_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyPolicyMetrics_date_idx" ON "LiteLLM_DailyPolicyMetrics"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyPolicyMetrics_policy_id_idx" ON "LiteLLM_DailyPolicyMetrics"("policy_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogGuardrailIndex_guardrail_id_start_time_idx" ON "LiteLLM_SpendLogGuardrailIndex"("guardrail_id", "start_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogGuardrailIndex_policy_id_start_time_idx" ON "LiteLLM_SpendLogGuardrailIndex"("policy_id", "start_time");

--> statement-breakpoint
-- Source migration: 20260220124742_add_spec_path_to_mcp_servers
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "spec_path" TEXT;
--> statement-breakpoint
-- Source migration: 20260220153844_add_composite_index_aggregate_tables
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyAgentSpend_agent_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTagSpend_tag_idx";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyTeamSpend_team_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_DailyUserSpend_user_id_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyAgentSpend_agent_id_date_idx" ON "LiteLLM_DailyAgentSpend"("agent_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_date_idx" ON "LiteLLM_DailyEndUserSpend"("end_user_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_date_idx" ON "LiteLLM_DailyOrganizationSpend"("organization_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTagSpend_tag_date_idx" ON "LiteLLM_DailyTagSpend"("tag", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyTeamSpend_team_id_date_idx" ON "LiteLLM_DailyTeamSpend"("team_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_DailyUserSpend_user_id_date_idx" ON "LiteLLM_DailyUserSpend"("user_id", "date");

--> statement-breakpoint
-- Source migration: 20260221000000_ensure_project_id_verification_token
-- Ensure project_id column exists in LiteLLM_VerificationToken.
-- The original migration (20251113000000_add_project_table) adds this column,
-- but if it failed partway through (e.g. LiteLLM_ProjectTable already existed)
-- and was resolved as idempotent, the ALTER TABLE step may have been skipped.
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
--> statement-breakpoint
-- Source migration: 20260221183800_add_policy_versioning
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_PolicyTable_policy_name_key";

-- AlterTable
ALTER TABLE "LiteLLM_PolicyTable" ADD COLUMN IF NOT EXISTS "is_latest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "parent_version_id" TEXT,
ADD COLUMN IF NOT EXISTS "production_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "version_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS "version_status" TEXT NOT NULL DEFAULT 'production';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_PolicyTable_policy_name_version_status_idx" ON "LiteLLM_PolicyTable"("policy_name", "version_status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_PolicyTable_policy_name_version_number_key" ON "LiteLLM_PolicyTable"("policy_name", "version_number");

--> statement-breakpoint
-- Source migration: 20260222000000_add_batch_processed_to_managed_object_table
-- Add batch_processed column to LiteLLM_ManagedObjectTable
-- Set to true by CheckBatchCost after cost has been computed for a completed batch
ALTER TABLE "LiteLLM_ManagedObjectTable" ADD COLUMN IF NOT EXISTS "batch_processed" BOOLEAN NOT NULL DEFAULT false;
--> statement-breakpoint
-- Source migration: 20260224201417_spend_logs_request_duration
-- AlterTable
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "request_duration_ms" INTEGER;

--> statement-breakpoint
-- Source migration: 20260224203854_add_agent_object_permissions_table
-- AlterTable
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "object_permission_id" TEXT;

-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" DROP COLUMN IF EXISTS "spec_path";

-- AlterTable
ALTER TABLE "LiteLLM_VerificationToken" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ToolTable" (
    "tool_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "origin" TEXT,
    "call_policy" TEXT NOT NULL DEFAULT 'untrusted',
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "assignments" JSONB DEFAULT '{}',
    "key_hash" TEXT,
    "team_id" TEXT,
    "key_alias" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_ToolTable_pkey" PRIMARY KEY ("tool_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ToolTable_tool_name_key" ON "LiteLLM_ToolTable"("tool_name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ToolTable_call_policy_idx" ON "LiteLLM_ToolTable"("call_policy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ToolTable_team_id_idx" ON "LiteLLM_ToolTable"("team_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_AgentsTable_object_permission_id_fkey') THEN
        ALTER TABLE "LiteLLM_AgentsTable" ADD CONSTRAINT "LiteLLM_AgentsTable_object_permission_id_fkey" FOREIGN KEY ("object_permission_id") REFERENCES "LiteLLM_ObjectPermissionTable"("object_permission_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20260226000000_add_blocked_tools_to_object_permission
-- AlterTable
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "blocked_tools" TEXT[] DEFAULT ARRAY[]::TEXT[];
--> statement-breakpoint
-- Source migration: 20260226120000_add_spend_log_tool_index
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_SpendLogToolIndex" (
    "request_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_SpendLogToolIndex_pkey" PRIMARY KEY ("request_id","tool_name")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogToolIndex_tool_name_start_time_idx" ON "LiteLLM_SpendLogToolIndex"("tool_name", "start_time");
--> statement-breakpoint
-- Source migration: 20260226202727_add_agent_id_to_delete_keys
-- AlterTable
ALTER TABLE "LiteLLM_DeletedVerificationToken" ADD COLUMN IF NOT EXISTS "agent_id" TEXT;

--> statement-breakpoint
-- Source migration: 20260228000000_add_claude_code_plugin_table
-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ClaudeCodePluginTable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "description" TEXT,
    "manifest_json" TEXT,
    "files_json" TEXT DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "LiteLLM_ClaudeCodePluginTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_ClaudeCodePluginTable_name_key" ON "LiteLLM_ClaudeCodePluginTable"("name");
--> statement-breakpoint
-- Source migration: 20260228100000_add_spend_logs_composite_index
-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogs_startTime_request_id_idx" ON "LiteLLM_SpendLogs"("startTime", "request_id");
--> statement-breakpoint
-- Source migration: 20260228110000_mcp_default_public_internet_true
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ALTER COLUMN "available_on_public_internet" SET DEFAULT true;
--> statement-breakpoint
-- Source migration: 20260228170127_support_team_based_guardrails
-- AlterTable
ALTER TABLE "LiteLLM_GuardrailsTable" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_GuardrailsTable_status_idx" ON "LiteLLM_GuardrailsTable"("status");

--> statement-breakpoint
-- Source migration: 20260303000000_update_tool_table_policies
-- Rename call_policy to input_policy (only if the old name still exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'LiteLLM_ToolTable' AND column_name = 'call_policy') THEN
        ALTER TABLE "LiteLLM_ToolTable" RENAME COLUMN "call_policy" TO "input_policy";
    END IF;
END $$;

-- Add output_policy column
ALTER TABLE "LiteLLM_ToolTable" ADD COLUMN IF NOT EXISTS "output_policy" TEXT NOT NULL DEFAULT 'untrusted';

-- Add user_agent column
ALTER TABLE "LiteLLM_ToolTable" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;

-- Add last_used_at column
ALTER TABLE "LiteLLM_ToolTable" ADD COLUMN IF NOT EXISTS "last_used_at" TIMESTAMP(3);

-- Drop old index on call_policy
DROP INDEX IF EXISTS "LiteLLM_ToolTable_call_policy_idx";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ToolTable_input_policy_idx" ON "LiteLLM_ToolTable"("input_policy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_ToolTable_output_policy_idx" ON "LiteLLM_ToolTable"("output_policy");
--> statement-breakpoint
-- Source migration: 20260304175016_add_spend_to_agent_table
-- AlterTable
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "spend" DOUBLE PRECISION NOT NULL DEFAULT 0.0;

--> statement-breakpoint
-- Source migration: 20260305000000_add_agent_headers
-- Add static_headers and extra_headers to LiteLLM_AgentsTable

ALTER TABLE "LiteLLM_AgentsTable"
  ADD COLUMN IF NOT EXISTS "static_headers" JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "extra_headers"  TEXT[] DEFAULT ARRAY[]::TEXT[];
--> statement-breakpoint
-- Source migration: 20260305000000_add_rate_limits_to_agents
-- AlterTable
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "tpm_limit" INTEGER;
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "rpm_limit" INTEGER;
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "session_tpm_limit" INTEGER;
ALTER TABLE "LiteLLM_AgentsTable" ADD COLUMN IF NOT EXISTS "session_rpm_limit" INTEGER;
--> statement-breakpoint
-- Source migration: 20260306175056_add_configs_override_table
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "spec_path" TEXT;

--> statement-breakpoint
-- Source migration: 20260306233848_schema_sync
-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" ADD COLUMN IF NOT EXISTS "byok_api_key_help_url" TEXT,
ADD COLUMN IF NOT EXISTS "byok_description" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "is_byok" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "tool_name_to_description" JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS "tool_name_to_display_name" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_MCPUserCredentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "server_id" TEXT NOT NULL,
    "credential_b64" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiteLLM_MCPUserCredentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_JWTKeyMapping" (
    "id" TEXT NOT NULL,
    "jwt_claim_name" TEXT NOT NULL,
    "jwt_claim_value" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "LiteLLM_JWTKeyMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LiteLLM_ConfigOverrides" (
    "config_type" TEXT NOT NULL,
    "config_value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_ConfigOverrides_pkey" PRIMARY KEY ("config_type")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_MCPUserCredentials_user_id_server_id_key" ON "LiteLLM_MCPUserCredentials"("user_id", "server_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_JWTKeyMapping_jwt_claim_name_jwt_claim_value_is_act_idx" ON "LiteLLM_JWTKeyMapping"("jwt_claim_name", "jwt_claim_value", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LiteLLM_JWTKeyMapping_jwt_claim_name_jwt_claim_value_key" ON "LiteLLM_JWTKeyMapping"("jwt_claim_name", "jwt_claim_value");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() AND con.conname = 'LiteLLM_JWTKeyMapping_token_fkey') THEN
        ALTER TABLE "LiteLLM_JWTKeyMapping" ADD CONSTRAINT "LiteLLM_JWTKeyMapping_token_fkey" FOREIGN KEY ("token") REFERENCES "LiteLLM_VerificationToken"("token") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

--> statement-breakpoint
-- Source migration: 20260309000000_add_mcp_approval_status
-- AlterTable: Add BYOM approval workflow fields to LiteLLM_MCPServerTable
ALTER TABLE "LiteLLM_MCPServerTable"
  ADD COLUMN IF NOT EXISTS "approval_status" TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "submitted_by"    TEXT,
  ADD COLUMN IF NOT EXISTS "submitted_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_notes"    TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_MCPServerTable_approval_status_idx"
  ON "LiteLLM_MCPServerTable"("approval_status");
--> statement-breakpoint
-- Source migration: 20260309000001_add_mcp_source_url
-- AlterTable: Add source_url field to LiteLLM_MCPServerTable for GitHub/docs link
ALTER TABLE "LiteLLM_MCPServerTable"
  ADD COLUMN IF NOT EXISTS "source_url" TEXT;
--> statement-breakpoint
-- Source migration: 20260311180521_schema_sync
-- DropIndex
DROP INDEX IF EXISTS "LiteLLM_MCPServerTable_approval_status_idx";

-- AlterTable
ALTER TABLE "LiteLLM_MCPServerTable" DROP COLUMN IF EXISTS "approval_status",
DROP COLUMN IF EXISTS "review_notes",
DROP COLUMN IF EXISTS "reviewed_at",
DROP COLUMN IF EXISTS "source_url",
DROP COLUMN IF EXISTS "submitted_at",
DROP COLUMN IF EXISTS "submitted_by";

--> statement-breakpoint
-- Source migration: 20260312124619_schema_sync
-- AlterTable
ALTER TABLE "LiteLLM_ObjectPermissionTable" ADD COLUMN IF NOT EXISTS "models" TEXT[] DEFAULT ARRAY[]::TEXT[];

--> statement-breakpoint
-- Source migration: 20260318140652_add_index_to_team_table
-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_TeamTable_organization_id_idx" ON "LiteLLM_TeamTable"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_TeamTable_team_alias_idx" ON "LiteLLM_TeamTable"("team_alias");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LiteLLM_TeamTable_created_at_idx" ON "LiteLLM_TeamTable"("created_at");
