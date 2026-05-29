import { pgTable, text, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

export const liteLLM_ErrorLogs = pgTable("LiteLLM_ErrorLogs", {
	request_id: uuid("request_id").defaultRandom().primaryKey(),
	startTime: timestamp("startTime").notNull(),
	endTime: timestamp("endTime").notNull(),
	api_base: text("api_base").default(""),
	model_group: text("model_group").default(""),
	litellm_model_name: text("litellm_model_name").default(""),
	model_id: text("model_id").default(""),
	request_kwargs: jsonb("request_kwargs").default("{}"),
	exception_type: text("exception_type").default(""),
	exception_string: text("exception_string").default(""),
	status_code: text("status_code").default(""),
});
