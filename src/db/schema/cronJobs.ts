import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const jobStatus = pgEnum("JobStatus", ["ACTIVE", "INACTIVE"]);

/**
 * Cron 任务表 - LiteLLM_CronJob (cuid PK, app 层生成)
 */
export const LiteLLM_CronJob = pgTable("LiteLLM_CronJob", {
	cronjob_id: text("cronjob_id").notNull().primaryKey(),
	pod_id: text("pod_id").notNull(),
	status: jobStatus("status").default("INACTIVE").notNull(),
	last_updated: timestamp("last_updated", { precision: 3 }).defaultNow().notNull(),
	ttl: timestamp("ttl", { precision: 3 }).notNull(),
});
