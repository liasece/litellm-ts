import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * 用户通知表 - LiteLLM_UserNotifications (自然键 PK)
 */
export const LiteLLM_UserNotifications = pgTable("LiteLLM_UserNotifications", {
	request_id: text("request_id").notNull().primaryKey(),
	user_id: text("user_id").notNull(),
	models: text("models").array().notNull(),
	justification: text("justification").notNull(),
	status: text("status").notNull(),
});
