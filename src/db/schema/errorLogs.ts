import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
export const liteLLM_ErrorLogs = pgTable("LiteLLM_ErrorLogs", {
	request_id: uuidText("request_id").primaryKey().notNull(),
	startTime: timestamp("startTime", { precision: 3 }).notNull(),
	endTime: timestamp("endTime", { precision: 3 }).notNull(),
	api_base: text("api_base").default("").notNull(),
	model_group: text("model_group").default("").notNull(),
	litellm_model_name: text("litellm_model_name").default("").notNull(),
	model_id: text("model_id").default("").notNull(),
	request_kwargs: jsonb("request_kwargs").default("{}").notNull(),
	exception_type: text("exception_type").default("").notNull(),
	exception_string: text("exception_string").default("").notNull(),
	status_code: text("status_code").default("").notNull(),
});
