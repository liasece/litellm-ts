import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

import { uuidText } from "./uuidText";
export const liteLLM_AuditLog = pgTable("LiteLLM_AuditLog", {
	id: uuidText("id").primaryKey().notNull(),
	updated_at: timestamp("updated_at", { precision: 3 }).defaultNow().notNull(),
	changed_by: text("changed_by").default("").notNull(),
	changed_by_api_key: text("changed_by_api_key").default("").notNull(),
	action: text("action").notNull(),
	table_name: text("table_name").notNull(),
	object_id: text("object_id").notNull(),
	before_value: jsonb("before_value"),
	updated_values: jsonb("updated_values"),
});
