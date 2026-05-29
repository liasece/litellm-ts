import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Cron 任务表 - LiteLLM_CronJob (cuid PK, app 层生成)
 */
export const LiteLLM_CronJob = pgTable("LiteLLM_CronJob", {
	cronjob_id: text("cronjob_id").notNull().primaryKey(),
	pod_id: text("pod_id").notNull(),
	status: text("status").default("INACTIVE"),
	last_updated: timestamp("last_updated").defaultNow(),
	ttl: timestamp("ttl").notNull(),
});
