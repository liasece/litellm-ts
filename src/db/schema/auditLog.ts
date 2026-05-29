import { pgTable, text, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

export const liteLLM_AuditLog = pgTable("LiteLLM_AuditLog", {
	id: uuid("id").defaultRandom().primaryKey(),
	updated_at: timestamp("updated_at").defaultNow(),
	changed_by: text("changed_by").default(""),
	changed_by_api_key: text("changed_by_api_key").default(""),
	action: text("action").notNull(),
	table_name: text("table_name").notNull(),
	object_id: text("object_id").notNull(),
	before_value: jsonb("before_value"),
	updated_values: jsonb("updated_values"),
});
